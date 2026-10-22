import { randomUUID } from 'crypto';
import prisma from '../config/prisma.js';

const DEFAULT_CIRCLES = [
  { slug: 'antarctic-climate', name: 'Antarctic Climate', topic: 'Climate & sea ice', description: 'Discuss observations, datasets and publications related to Antarctic climate and sea-ice change.' },
  { slug: 'polar-biodiversity', name: 'Polar Biodiversity', topic: 'Biology & ecology', description: 'Share and discuss documented observations of polar species and ecosystems.' },
  { slug: 'ocean-research', name: 'Southern Ocean Research', topic: 'Oceanography', description: 'Connect around oceanographic observations, temperature, salinity and circulation data.' },
  { slug: 'student-polar-lab', name: 'Student Polar Lab', topic: 'Students & learning', description: 'A research-friendly space for students to ask questions, learn from records and collaborate.' },
];

async function ensureCircles() {
  await Promise.all(DEFAULT_CIRCLES.map((circle) => prisma.communityCircle.upsert({
    where: { slug: circle.slug },
    update: {},
    create: circle,
  })));
}

async function getCurrentUser(req) {
  if (!req.user?.id) return null;
  return prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true, role: true } });
}

async function requireCurrentUser(req, res) {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
    return null;
  }
  return user;
}

function cleanText(value, max) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : '';
}

function parseCoordinate(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return NaN;
  return n;
}

export const getOverview = async (req, res) => {
  try {
    await ensureCircles();
    const currentUser = req.user?.id ? await getCurrentUser(req) : null;
    const [observations, publishedPosts, contributors, datasets, circles] = await Promise.all([
      prisma.polarObservation.count(),
      prisma.communityPost.count({ where: { status: 'published' } }),
      prisma.user.count({ where: { OR: [{ communityPosts: { some: {} } }, { observations: { some: {} } }] } }),
      prisma.contentItem.count({ where: { type: 'dataset', status: 'published' } }),
      prisma.communityCircle.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { memberships: true, posts: true } } },
      }),
    ]);
    const memberships = currentUser
      ? await prisma.communityMembership.findMany({ where: { userId: currentUser.id }, select: { circleId: true } })
      : [];
    const joinedIds = new Set(memberships.map((m) => m.circleId));
    const enrichedCircles = circles.map((circle) => ({ ...circle, joinedByMe: joinedIds.has(circle.id) }));
    const joinedCircles = enrichedCircles.filter((circle) => circle.joinedByMe);
    res.json({
      metrics: { observations, communityPosts: publishedPosts, activeContributors: contributors, openDatasets: datasets },
      circles: enrichedCircles,
      joinedCircles,
      joinedCircleIds: [...joinedIds],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const listObservations = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const observations = await prisma.polarObservation.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, name: true, organization: true, role: true } },
        expedition: { select: { id: true, name: true, region: true } },
      },
    });
    res.json(observations);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const createObservation = async (req, res) => {
  const title = cleanText(req.body.title, 180);
  const observationType = cleanText(req.body.observationType, 80);
  const description = cleanText(req.body.description, 5000);
  if (!title || !observationType || !description) return res.status(400).json({ error: 'Title, observation type and description are required.' });
  const observedAt = new Date(req.body.observedAt || Date.now());
  if (Number.isNaN(observedAt.getTime())) return res.status(400).json({ error: 'Observation date is invalid.' });
  const latitude = parseCoordinate(req.body.latitude, -90, 90);
  const longitude = parseCoordinate(req.body.longitude, -180, 180);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return res.status(400).json({ error: 'Coordinates are invalid.' });
  const region = ['Arctic', 'Antarctic', 'Himalaya', 'Southern_Ocean', 'Other'].includes(req.body.region) ? req.body.region : null;
  try {
    const observation = await prisma.polarObservation.create({
      data: {
        id: randomUUID(), title, observationType, description, observedAt, region,
        latitude, longitude, confidence: cleanText(req.body.confidence || 'unverified', 40) || 'unverified',
        evidenceUrl: cleanText(req.body.evidenceUrl, 1000) || null,
        expeditionId: cleanText(req.body.expeditionId, 80) || null,
        createdBy: req.user.id,
      },
      include: { creator: { select: { id: true, name: true, organization: true, role: true } }, expedition: { select: { id: true, name: true, region: true } } },
    });
    res.status(201).json(observation);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const listPosts = async (req, res) => {
  try {
    await ensureCircles();
    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 50);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;
    const posts = await prisma.communityPost.findMany({
      where: { status: 'published', ...(req.query.circleId ? { circleId: req.query.circleId } : {}) },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, name: true, organization: true, role: true } },
        circle: { select: { id: true, name: true, topic: true } },
        expedition: { select: { id: true, name: true } },
        comments: { take: 3, orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true, role: true } } } },
        _count: { select: { comments: true, likes: true } },
      },
    });
    const userId = req.user?.id;
    const liked = userId ? await prisma.communityPostLike.findMany({ where: { userId, postId: { in: posts.map((p) => p.id) } }, select: { postId: true } }) : [];
    const likedSet = new Set(liked.map((x) => x.postId));
    // A full page means there might be more after it; fewer than that
    // means we've reached the end of the feed.
    const nextCursor = posts.length === limit ? posts[posts.length - 1].id : null;
    res.json({ posts: posts.map((p) => ({ ...p, likedByMe: likedSet.has(p.id) })), nextCursor });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const createPost = async (req, res) => {
  const title = cleanText(req.body.title, 180);
  const body = cleanText(req.body.body, 5000);
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required.' });
  try {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;
    await ensureCircles();
    const circleId = cleanText(req.body.circleId, 80);
    if (!circleId) return res.status(400).json({ error: 'Select a community you have joined before posting.' });

    const circle = await prisma.communityCircle.findUnique({ where: { id: circleId } });
    if (!circle) return res.status(400).json({ error: 'Community circle not found.' });

    const membership = await prisma.communityMembership.findUnique({
      where: { userId_circleId: { userId: currentUser.id, circleId } },
    });
    if (!membership) return res.status(403).json({ error: 'You can only post in communities you have joined.' });

    const tags = Array.isArray(req.body.tags) ? req.body.tags.map((x) => cleanText(x, 40)).filter(Boolean).slice(0, 6) : [];
    const expeditionId = cleanText(req.body.expeditionId, 80) || null;
    if (expeditionId) {
      const expedition = await prisma.expedition.findUnique({ where: { id: expeditionId }, select: { id: true } });
      if (!expedition) return res.status(400).json({ error: 'Linked expedition not found.' });
    }
    const post = await prisma.communityPost.create({
      data: { title, body, tags, circleId, expeditionId, createdBy: currentUser.id },
      include: { creator: { select: { id: true, name: true, organization: true, role: true } }, circle: true, _count: { select: { comments: true, likes: true } } },
    });
    res.status(201).json({ ...post, likedByMe: false });
  } catch (err) {
    if (err.code === 'P2003') return res.status(400).json({ error: 'The selected user or community no longer exists. Please sign in again and retry.' });
    res.status(500).json({ error: err.message });
  }
};

export const joinCircle = async (req, res) => {
  try {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;
    const circle = await prisma.communityCircle.findUnique({ where: { id: req.params.id } });
    if (!circle) return res.status(404).json({ error: 'Community circle not found.' });
    const membership = await prisma.communityMembership.upsert({
      where: { userId_circleId: { userId: currentUser.id, circleId: circle.id } },
      update: {},
      create: { userId: currentUser.id, circleId: circle.id },
    });
    res.status(201).json({ joined: true, membership });
  } catch (err) {
    if (err.code === 'P2003') return res.status(401).json({ error: 'Your account could not be found. Please sign in again.' });
    res.status(500).json({ error: err.message });
  }
};

export const leaveCircle = async (req, res) => {
  try {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    const circle = await prisma.communityCircle.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!circle) return res.status(404).json({ error: 'Community circle not found.' });

    const membership = await prisma.communityMembership.findUnique({
      where: { userId_circleId: { userId: currentUser.id, circleId: circle.id } },
    });
    if (!membership) return res.status(404).json({ error: 'You are not a member of this community.' });

    await prisma.communityMembership.delete({
      where: { userId_circleId: { userId: currentUser.id, circleId: circle.id } },
    });

    res.json({ joined: false, circleId: circle.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deletePost = async (req, res) => {
  try {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    const post = await prisma.communityPost.findUnique({
      where: { id: req.params.id },
      select: { id: true, createdBy: true, title: true },
    });
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.createdBy !== currentUser.id) {
      return res.status(403).json({ error: 'You can only delete your own community posts.' });
    }

    await prisma.communityPost.delete({ where: { id: post.id } });
    res.json({ deleted: true, postId: post.id });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Post not found.' });
    res.status(500).json({ error: err.message });
  }
};

export const toggleLike = async (req, res) => {
  try {
    const existing = await prisma.communityPostLike.findUnique({ where: { postId_userId: { postId: req.params.id, userId: req.user.id } } });
    if (existing) await prisma.communityPostLike.delete({ where: { postId_userId: { postId: req.params.id, userId: req.user.id } } });
    else await prisma.communityPostLike.create({ data: { postId: req.params.id, userId: req.user.id } });
    const count = await prisma.communityPostLike.count({ where: { postId: req.params.id } });
    res.json({ liked: !existing, likes: count });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const addComment = async (req, res) => {
  const body = cleanText(req.body.body, 2000);
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });
  try {
    const comment = await prisma.communityComment.create({
      data: { postId: req.params.id, userId: req.user.id, body },
      include: { user: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json(comment);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const verifyPost = async (req, res) => {
  try {
    const post = await prisma.communityPost.update({ where: { id: req.params.id }, data: { verified: true } });
    res.json(post);
  } catch (err) { if (err.code === 'P2025') return res.status(404).json({ error: 'Post not found.' }); res.status(500).json({ error: err.message }); }
};

export const listInstitutionalActivities = async (req, res) => {
  try {
    const activities = await prisma.activity.findMany({
      where: { status: 'published' },
      orderBy: [{ activityDate: 'asc' }, { startTime: 'asc' }],
      include: { creator: { select: { id: true, name: true, role: true } } },
    });
    res.json(activities);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const createInstitutionalActivity = async (req, res) => {
  const title = cleanText(req.body.title, 180);
  const description = cleanText(req.body.description, 5000);
  const location = cleanText(req.body.location, 300);
  const organizer = cleanText(req.body.organizer, 180);
  const date = cleanText(req.body.date, 20);
  const startTime = cleanText(req.body.startTime, 10);
  const endTime = cleanText(req.body.endTime, 10);
  if (!title || !description || !location || !organizer || !date || !startTime) {
    return res.status(400).json({ error: 'Title, description, location, organizer, date and start time are required.' });
  }
  const start = new Date(`${date}T${startTime}:00`);
  const end = endTime ? new Date(`${date}T${endTime}:00`) : null;
  if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) {
    return res.status(400).json({ error: 'Event date or time is invalid.' });
  }
  if (end && end <= start) return res.status(400).json({ error: 'End time must be after the start time.' });
  try {
    const activity = await prisma.activity.create({
      data: {
        title, description, location, organizer,
        activityDate: new Date(`${date}T00:00:00`),
        startTime: start, endTime: end,
        activityType: 'institutional_event', status: 'published', createdBy: req.user.id,
      },
      include: { creator: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json(activity);
  } catch (err) { res.status(500).json({ error: err.message }); }
};
