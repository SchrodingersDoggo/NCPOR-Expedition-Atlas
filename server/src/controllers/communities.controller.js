import streamifier from 'streamifier';
import prisma from '../config/prisma.js';
import cloudinary from '../config/cloudinary.js';
import { notify } from '../services/notification.service.js';

// ---------------------------------------------------------------------------
// Reddit-style Communities.
//
// Tables are the existing community_* tables (extended by the
// 20260923100000_add_reddit_communities migration), so every circle, post,
// comment and like created before this update is still here.
//
// Community types:
//   public     anyone can view; joining is instant; members post
//   restricted anyone can view and comment; joining sends a request and
//              only approved members can post
//   private    only approved members can view anything
// ---------------------------------------------------------------------------

const COMMUNITY_TYPES = ['public', 'restricted', 'private'];
const POST_TYPES = ['text', 'media', 'link', 'news'];
const NEWS_ROLES = ['researcher', 'comms_officer', 'admin'];
const STAFF_ROLES = ['comms_officer', 'admin'];
const COMMUNITY_CREATOR_ROLES = ['researcher', 'comms_officer', 'admin'];
const MAX_MEDIA = 4;

const AUTHOR_SELECT = { id: true, name: true, avatarUrl: true, role: true, organization: true };

const clean = (value, max = 5000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function slugify(name) {
  return name.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').slice(0, 21);
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => clean(String(t), 30)).filter(Boolean))].slice(0, 5);
}

// Reddit's classic "hot" ranking: log-scaled score plus a time bonus, so
// new posts with a few votes can outrank old posts with many.
function hotRank(post) {
  const s = post.score || 0;
  const order = Math.log10(Math.max(Math.abs(s), 1));
  const sign = s > 0 ? 1 : s < 0 ? -1 : 0;
  const seconds = new Date(post.createdAt).getTime() / 1000 - 1134028003;
  return sign * order + seconds / 45000;
}

const TOP_WINDOWS = { day: 1, week: 7, month: 30, year: 365 };

function asyncHandler(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error('[communities]', err);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  });
}

// --- membership helpers ----------------------------------------------------

async function getMembership(userId, circleId) {
  if (!userId) return null;
  return prisma.communityMembership.findUnique({ where: { userId_circleId: { userId, circleId } } });
}

function isStaff(user) {
  return Boolean(user && STAFF_ROLES.includes(user.role));
}

function canView(community, membership, user) {
  if (community.type !== 'private') return true;
  if (isStaff(user)) return true;
  return membership?.status === 'active';
}

function canPost(community, membership) {
  return membership?.status === 'active';
}

function canComment(community, membership, user) {
  if (!user) return false;
  if (community.type === 'public') return true; // Reddit lets anyone comment in public communities
  if (community.type === 'restricted') return Boolean(membership); // pending or active
  return membership?.status === 'active';
}

function isModerator(membership, user) {
  return (membership?.role === 'moderator' && membership?.status === 'active') || isStaff(user);
}

// Ids of private communities the user may see — used to build a
// visibility filter for every post listing.
async function visibilityFilter(user) {
  const privateIds = user
    ? (await prisma.communityMembership.findMany({
      where: { userId: user.id, status: 'active', circle: { type: 'private' } },
      select: { circleId: true },
    })).map((m) => m.circleId)
    : [];
  if (isStaff(user)) return {};
  return {
    OR: [
      { circleId: null },
      { circle: { type: { not: 'private' } } },
      ...(privateIds.length ? [{ circleId: { in: privateIds } }] : []),
    ],
  };
}


async function visibleCommunityWhere(user) {
  if (isStaff(user)) return {};
  const privateIds = user
    ? (await prisma.communityMembership.findMany({
      where: { userId: user.id, status: 'active', circle: { type: 'private' } },
      select: { circleId: true },
    })).map((m) => m.circleId)
    : [];
  return {
    OR: [
      { type: { not: 'private' } },
      ...(privateIds.length ? [{ id: { in: privateIds } }] : []),
    ],
  };
}

function serializeCommunity(c, membership) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    topic: c.topic,
    type: c.type,
    rules: Array.isArray(c.rules) ? c.rules : [],
    iconColor: c.iconColor,
    bannerColor: c.bannerColor,
    createdAt: c.createdAt,
    creator: c.creator || null,
    memberCount: c._count?.memberships ?? undefined,
    postCount: c._count?.posts ?? undefined,
    membership: membership
      ? { role: membership.role, status: membership.status, favorite: membership.favorite, joinedAt: membership.joinedAt }
      : null,
  };
}

const COMMUNITY_COUNTS = { _count: { select: { posts: true, memberships: { where: { status: 'active' } } } } };

const POST_INCLUDE = {
  creator: { select: AUTHOR_SELECT },
  circle: { select: { id: true, slug: true, name: true, type: true, iconColor: true } },
  expedition: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
};

async function attachMyVotes(posts, user) {
  if (!user || posts.length === 0) return posts.map((p) => ({ ...p, myVote: 0 }));
  const votes = await prisma.communityPostVote.findMany({
    where: { userId: user.id, postId: { in: posts.map((p) => p.id) } },
    select: { postId: true, value: true },
  });
  const byId = new Map(votes.map((v) => [v.postId, v.value]));
  return posts.map((p) => ({ ...p, myVote: byId.get(p.id) || 0 }));
}

function serializePost(p) {
  const { likes, votes, ...rest } = p;
  return {
    ...rest,
    tags: Array.isArray(p.tags) ? p.tags : [],
    media: Array.isArray(p.media) ? p.media : [],
    commentCount: p._count?.comments ?? 0,
  };
}

// ===========================================================================
// Communities
// ===========================================================================

// GET /api/communities?q=&topic=&sort=members|new&limit=
export const listCommunities = asyncHandler(async (req, res) => {
  const q = clean(req.query.q, 80);
  const topic = clean(req.query.topic, 60);
  const limit = Math.min(Number(req.query.limit) || 30, 60);
  const visibility = await visibleCommunityWhere(req.user);
  const filters = [];
  if (Object.keys(visibility).length) filters.push(visibility);
  if (q) filters.push({ OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] });
  if (topic) filters.push({ topic: { equals: topic, mode: 'insensitive' } });
  const where = filters.length ? { AND: filters } : {};
  const orderBy = req.query.sort === 'new' ? { createdAt: 'desc' } : { memberships: { _count: 'desc' } };
  const [communities, topics] = await Promise.all([
    prisma.communityCircle.findMany({ where, orderBy, take: limit, include: COMMUNITY_COUNTS }),
    prisma.communityCircle.groupBy({ by: ['topic'], where: visibility, _count: { topic: true }, orderBy: { _count: { topic: 'desc' } }, take: 20 }),
  ]);
  const memberships = req.user
    ? await prisma.communityMembership.findMany({ where: { userId: req.user.id, circleId: { in: communities.map((c) => c.id) } } })
    : [];
  const byCircle = new Map(memberships.map((m) => [m.circleId, m]));
  res.json({
    communities: communities.map((c) => serializeCommunity(c, byCircle.get(c.id))),
    topics: topics.map((t) => t.topic),
  });
});

// GET /api/communities/mine — joined communities (sidebar + Manage Communities)
export const myCommunities = asyncHandler(async (req, res) => {
  const memberships = await prisma.communityMembership.findMany({
    where: { userId: req.user.id },
    include: { circle: { include: COMMUNITY_COUNTS } },
    orderBy: [{ favorite: 'desc' }, { joinedAt: 'desc' }],
  });
  res.json({ communities: memberships.map((m) => serializeCommunity(m.circle, m)) });
});

// POST /api/communities
export const createCommunity = asyncHandler(async (req, res) => {
  if (!COMMUNITY_CREATOR_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Only researchers, communications officers and admins can start communities.' });
  }
  const name = clean(req.body.name, 60);
  const slug = slugify(name);
  const description = clean(req.body.description, 500);
  const topic = clean(req.body.topic, 60) || 'General';
  const type = COMMUNITY_TYPES.includes(req.body.type) ? req.body.type : 'public';
  const rules = (Array.isArray(req.body.rules) ? req.body.rules : [])
    .map((r) => clean(String(r), 200)).filter(Boolean).slice(0, 10);
  const iconColor = /^#[0-9a-fA-F]{6}$/.test(req.body.iconColor || '') ? req.body.iconColor : null;
  const bannerColor = /^#[0-9a-fA-F]{6}$/.test(req.body.bannerColor || '') ? req.body.bannerColor : null;

  if (slug.length < 3) return res.status(400).json({ error: 'Community name must be 3–21 characters (letters, numbers, underscores).' });
  if (!description) return res.status(400).json({ error: 'Add a short description so researchers know what the community is about.' });

  const exists = await prisma.communityCircle.findFirst({ where: { slug: { equals: slug, mode: 'insensitive' } } });
  if (exists) return res.status(409).json({ error: `c/${slug} already exists. Try another name.` });

  const community = await prisma.communityCircle.create({
    data: {
      slug, name, description, topic, type, rules, iconColor, bannerColor, createdBy: req.user.id,
      memberships: { create: { userId: req.user.id, role: 'moderator', status: 'active' } },
    },
    include: COMMUNITY_COUNTS,
  });
  const membership = await getMembership(req.user.id, community.id);
  res.status(201).json(serializeCommunity(community, membership));
});

// GET /api/communities/c/:slug
export const getCommunity = asyncHandler(async (req, res) => {
  const community = await prisma.communityCircle.findUnique({
    where: { slug: req.params.slug },
    include: { ...COMMUNITY_COUNTS, creator: { select: { id: true, name: true } } },
  });
  if (!community) return res.status(404).json({ error: 'Community not found.' });
  const membership = await getMembership(req.user?.id, community.id);
  const allowedToView = canView(community, membership, req.user);

  // A private community may be reached by a direct/shared URL so a user can
  // request access, but its metadata stays private until membership is approved.
  if (!allowedToView) {
    return res.json({
      id: community.id,
      slug: community.slug,
      name: community.name,
      type: community.type,
      membership: membership
        ? { role: membership.role, status: membership.status, favorite: membership.favorite, joinedAt: membership.joinedAt }
        : null,
      description: '',
      topic: 'Private community',
      rules: [],
      iconColor: community.iconColor,
      bannerColor: community.bannerColor,
      createdAt: community.createdAt,
      creator: null,
      moderators: [],
      canView: false,
      canPost: false,
      canComment: false,
      isModerator: false,
      pendingCount: 0,
    });
  }

  const moderators = await prisma.communityMembership.findMany({
    where: { circleId: community.id, role: 'moderator', status: 'active' },
    include: { user: { select: { id: true, name: true } } },
  });
  const pendingCount = isModerator(membership, req.user)
    ? await prisma.communityMembership.count({ where: { circleId: community.id, status: 'pending' } })
    : 0;
  res.json({
    ...serializeCommunity(community, membership),
    moderators: moderators.map((m) => m.user),
    canView: true,
    canPost: canPost(community, membership),
    canComment: canComment(community, membership, req.user),
    isModerator: isModerator(membership, req.user),
    pendingCount,
  });
});

// PATCH /api/communities/c/:slug — moderators only
export const updateCommunity = asyncHandler(async (req, res) => {
  const community = await prisma.communityCircle.findUnique({ where: { slug: req.params.slug } });
  if (!community) return res.status(404).json({ error: 'Community not found.' });
  const membership = await getMembership(req.user.id, community.id);
  if (!isModerator(membership, req.user)) return res.status(403).json({ error: 'Only moderators can edit this community.' });

  const data = {};
  if (req.body.description !== undefined) data.description = clean(req.body.description, 500);
  if (req.body.topic !== undefined) data.topic = clean(req.body.topic, 60) || community.topic;
  if (COMMUNITY_TYPES.includes(req.body.type)) data.type = req.body.type;
  if (Array.isArray(req.body.rules)) data.rules = req.body.rules.map((r) => clean(String(r), 200)).filter(Boolean).slice(0, 10);
  if (/^#[0-9a-fA-F]{6}$/.test(req.body.iconColor || '')) data.iconColor = req.body.iconColor;
  if (/^#[0-9a-fA-F]{6}$/.test(req.body.bannerColor || '')) data.bannerColor = req.body.bannerColor;

  const updated = await prisma.communityCircle.update({ where: { id: community.id }, data, include: COMMUNITY_COUNTS });
  res.json(serializeCommunity(updated, membership));
});

// POST /api/communities/c/:slug/join
export const joinCommunity = asyncHandler(async (req, res) => {
  const community = await prisma.communityCircle.findUnique({ where: { slug: req.params.slug } });
  if (!community) return res.status(404).json({ error: 'Community not found.' });
  const existing = await getMembership(req.user.id, community.id);
  if (existing) return res.json({ status: existing.status, role: existing.role });

  const status = community.type === 'public' ? 'active' : 'pending';
  const membership = await prisma.communityMembership.create({
    data: { userId: req.user.id, circleId: community.id, status },
  });

  if (status === 'pending') {
    const [mods, requester] = await Promise.all([
      prisma.communityMembership.findMany({ where: { circleId: community.id, role: 'moderator', status: 'active' }, select: { userId: true } }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } }),
    ]);
    await Promise.all(mods.map((m) => notify({
      userId: m.userId, actorId: req.user.id, type: 'join_request',
      title: `${requester?.name || 'A researcher'} asked to join c/${community.slug}`,
      link: `/communities/c/${community.slug}/manage`,
    })));
  }
  res.status(201).json({ status: membership.status, role: membership.role });
});

// DELETE /api/communities/c/:slug/leave
export const leaveCommunity = asyncHandler(async (req, res) => {
  const community = await prisma.communityCircle.findUnique({ where: { slug: req.params.slug } });
  if (!community) return res.status(404).json({ error: 'Community not found.' });
  const membership = await getMembership(req.user.id, community.id);
  if (!membership) return res.json({ left: true });
  if (community.createdBy === req.user.id) {
    return res.status(400).json({ error: 'The community creator cannot leave without transferring ownership. Keep this account as moderator for now.' });
  }

  if (membership.role === 'moderator') {
    const [otherMods, otherMembers] = await Promise.all([
      prisma.communityMembership.count({ where: { circleId: community.id, role: 'moderator', status: 'active', userId: { not: req.user.id } } }),
      prisma.communityMembership.count({ where: { circleId: community.id, status: 'active', userId: { not: req.user.id } } }),
    ]);
    if (otherMods === 0 && otherMembers > 0) {
      return res.status(400).json({ error: 'You are the only moderator. Make another member a moderator before leaving.' });
    }
  }
  await prisma.communityMembership.delete({ where: { userId_circleId: { userId: req.user.id, circleId: community.id } } });
  res.json({ left: true });
});

// PATCH /api/communities/c/:slug/favorite  { favorite: boolean }
export const setFavorite = asyncHandler(async (req, res) => {
  const community = await prisma.communityCircle.findUnique({ where: { slug: req.params.slug } });
  if (!community) return res.status(404).json({ error: 'Community not found.' });
  const membership = await getMembership(req.user.id, community.id);
  if (!membership) return res.status(400).json({ error: 'Join the community first.' });
  const updated = await prisma.communityMembership.update({
    where: { userId_circleId: { userId: req.user.id, circleId: community.id } },
    data: { favorite: Boolean(req.body.favorite) },
  });
  res.json({ favorite: updated.favorite });
});

// GET /api/communities/c/:slug/members?status=pending|active — moderators
export const listMembers = asyncHandler(async (req, res) => {
  const community = await prisma.communityCircle.findUnique({ where: { slug: req.params.slug } });
  if (!community) return res.status(404).json({ error: 'Community not found.' });
  const membership = await getMembership(req.user.id, community.id);
  if (!isModerator(membership, req.user)) return res.status(403).json({ error: 'Moderators only.' });
  const status = req.query.status === 'pending' ? 'pending' : 'active';
  const members = await prisma.communityMembership.findMany({
    where: { circleId: community.id, status },
    include: { user: { select: { id: true, name: true, organization: true, role: true } } },
    orderBy: { joinedAt: 'desc' },
    take: 200,
  });
  res.json({ members: members.map((m) => ({ ...m.user, memberRole: m.role, status: m.status, joinedAt: m.joinedAt })) });
});

async function modAction(req, res, action) {
  const community = await prisma.communityCircle.findUnique({ where: { slug: req.params.slug } });
  if (!community) return res.status(404).json({ error: 'Community not found.' });
  const mine = await getMembership(req.user.id, community.id);
  if (!isModerator(mine, req.user)) return res.status(403).json({ error: 'Moderators only.' });
  const target = await getMembership(req.params.userId, community.id);
  if (!target) return res.status(404).json({ error: 'That user is not a member or requester.' });
  return action(community, target);
}

// POST /api/communities/c/:slug/members/:userId/approve
export const approveMember = asyncHandler((req, res) => modAction(req, res, async (community, target) => {
  await prisma.communityMembership.update({
    where: { userId_circleId: { userId: target.userId, circleId: community.id } },
    data: { status: 'active' },
  });
  await notify({
    userId: target.userId, actorId: req.user.id, type: 'join_approved',
    title: `You're now an approved member of c/${community.slug}`,
    link: `/communities/c/${community.slug}`,
  });
  res.json({ approved: true });
}));

// POST /api/communities/c/:slug/members/:userId/moderator
export const makeModerator = asyncHandler((req, res) => modAction(req, res, async (community, target) => {
  if (target.status !== 'active') return res.status(400).json({ error: 'Approve the member first.' });
  await prisma.communityMembership.update({
    where: { userId_circleId: { userId: target.userId, circleId: community.id } },
    data: { role: 'moderator' },
  });
  res.json({ moderator: true });
}));

// DELETE /api/communities/c/:slug/members/:userId/moderator — demote moderator to member
export const removeModerator = asyncHandler((req, res) => modAction(req, res, async (community, target) => {
  if (target.userId === community.createdBy) {
    return res.status(400).json({ error: 'The community creator cannot be demoted.' });
  }
  if (target.role !== 'moderator' || target.status !== 'active') {
    return res.status(400).json({ error: 'That user is not an active moderator.' });
  }
  await prisma.communityMembership.update({
    where: { userId_circleId: { userId: target.userId, circleId: community.id } },
    data: { role: 'member' },
  });
  res.json({ moderator: false });
}));

// DELETE /api/communities/c/:slug/members/:userId — reject request / remove member
export const removeMember = asyncHandler((req, res) => modAction(req, res, async (community, target) => {
  if (target.userId === req.user.id) return res.status(400).json({ error: 'Use Leave to remove yourself.' });
  if (target.userId === community.createdBy) return res.status(400).json({ error: 'The community creator cannot be removed.' });
  await prisma.communityMembership.delete({ where: { userId_circleId: { userId: target.userId, circleId: community.id } } });
  res.json({ removed: true });
}));

// ===========================================================================
// Posts
// ===========================================================================

// GET /api/communities/feed?feed=home|popular|news|all&community=slug&author=id&sort=hot|new|top&t=day|week|month|year|all&page=0&limit=15
export const getFeed = asyncHandler(async (req, res) => {
  const feed = req.query.feed || 'popular';
  const sort = ['hot', 'new', 'top'].includes(req.query.sort) ? req.query.sort : 'hot';
  const limit = Math.min(Number(req.query.limit) || 15, 30);
  const page = Math.max(Number(req.query.page) || 0, 0);
  const user = req.user;

  const where = { AND: [{ status: 'published' }, await visibilityFilter(user)] };
  let homeFallback = false;

  if (req.query.community) {
    const community = await prisma.communityCircle.findUnique({ where: { slug: req.query.community } });
    if (!community) return res.status(404).json({ error: 'Community not found.' });
    const membership = await getMembership(user?.id, community.id);
    if (!canView(community, membership, user)) return res.status(403).json({ error: 'This community is private. Request to join to see its posts.' });
    where.AND.push({ circleId: community.id });
  } else if (req.query.author) {
    where.AND.push({ createdBy: String(req.query.author) });
  } else if (feed === 'news') {
    where.AND.push({ postType: 'news' });
  } else if (feed === 'home' && user) {
    const joined = await prisma.communityMembership.findMany({ where: { userId: user.id, status: 'active' }, select: { circleId: true } });
    if (joined.length) where.AND.push({ circleId: { in: joined.map((j) => j.circleId) } });
    else { homeFallback = true; where.AND.push({ postType: { not: 'news' } }); }
  } else if (feed === 'popular' || feed === 'home') {
    where.AND.push({ postType: { not: 'news' } }, { circle: { type: { not: 'private' } } });
  }

  if (sort === 'top' && TOP_WINDOWS[req.query.t]) {
    where.AND.push({ createdAt: { gte: new Date(Date.now() - TOP_WINDOWS[req.query.t] * 86400000) } });
  }

  let posts;
  let hasMore;
  if (sort === 'hot') {
    // Rank a recent candidate window in memory — plenty for a research
    // portal's volume and keeps the query simple and index-friendly.
    const candidates = await prisma.communityPost.findMany({ where, orderBy: { createdAt: 'desc' }, take: 400, include: POST_INCLUDE });
    candidates.sort((a, b) => hotRank(b) - hotRank(a));
    posts = candidates.slice(page * limit, page * limit + limit);
    hasMore = candidates.length > (page + 1) * limit;
  } else {
    const orderBy = sort === 'top' ? [{ score: 'desc' }, { createdAt: 'desc' }] : { createdAt: 'desc' };
    const rows = await prisma.communityPost.findMany({ where, orderBy, skip: page * limit, take: limit + 1, include: POST_INCLUDE });
    hasMore = rows.length > limit;
    posts = rows.slice(0, limit);
  }

  const withVotes = await attachMyVotes(posts, user);
  res.json({ posts: withVotes.map(serializePost), page, hasMore, homeFallback });
});

// GET /api/communities/posts/:id — post + threaded comments
export const getPost = asyncHandler(async (req, res) => {
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.id }, include: { ...POST_INCLUDE, circle: true } });
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Post not found.' });

  let membership = null;
  if (post.circle) {
    membership = await getMembership(req.user?.id, post.circle.id);
    if (!canView(post.circle, membership, req.user)) return res.status(403).json({ error: 'This post is in a private community.' });
  }

  const comments = await prisma.communityComment.findMany({
    where: { postId: post.id },
    orderBy: { createdAt: 'asc' },
    take: 500,
    include: { user: { select: AUTHOR_SELECT } },
  });
  let myCommentVotes = new Map();
  if (req.user && comments.length) {
    const votes = await prisma.communityCommentVote.findMany({
      where: { userId: req.user.id, commentId: { in: comments.map((c) => c.id) } },
      select: { commentId: true, value: true },
    });
    myCommentVotes = new Map(votes.map((v) => [v.commentId, v.value]));
  }

  const [withVote] = await attachMyVotes([post], req.user);
  const { circle, ...rest } = withVote;
  res.json({
    post: serializePost({
      ...rest,
      circle: circle ? { id: circle.id, slug: circle.slug, name: circle.name, type: circle.type, iconColor: circle.iconColor } : null,
    }),
    comments: comments.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      body: c.deleted ? '[deleted]' : c.body,
      deleted: c.deleted,
      score: c.score,
      createdAt: c.createdAt,
      user: c.deleted ? null : c.user,
      myVote: myCommentVotes.get(c.id) || 0,
    })),
    permissions: {
      canComment: post.circle ? canComment(post.circle, membership, req.user) : Boolean(req.user),
      isModerator: post.circle ? isModerator(membership, req.user) : isStaff(req.user),
    },
  });
});

// POST /api/communities/posts
// { communitySlug?, title, body, postType, linkUrl, media[], tags[], expeditionId }
export const createPost = asyncHandler(async (req, res) => {
  const postType = POST_TYPES.includes(req.body.postType) ? req.body.postType : 'text';
  const title = clean(req.body.title, 300);
  const body = clean(req.body.body, 40000);
  const tags = cleanTags(req.body.tags);
  const linkUrl = clean(req.body.linkUrl, 2000);
  const expeditionId = clean(req.body.expeditionId, 80) || null;

  if (!title) return res.status(400).json({ error: 'A title is required.' });
  if (linkUrl && !isHttpUrl(linkUrl)) return res.status(400).json({ error: 'The link must start with http:// or https://' });

  // Only accept media that went through our own upload endpoint (Cloudinary).
  const media = (Array.isArray(req.body.media) ? req.body.media : [])
    .filter((m) => m && typeof m.url === 'string' && m.url.startsWith('https://res.cloudinary.com/') && ['image', 'video'].includes(m.type))
    .slice(0, MAX_MEDIA)
    .map((m) => ({
      url: m.url, type: m.type,
      thumbnailUrl: typeof m.thumbnailUrl === 'string' && m.thumbnailUrl.startsWith('https://res.cloudinary.com/') ? m.thumbnailUrl : null,
      width: Number(m.width) || null, height: Number(m.height) || null,
    }));

  if (postType === 'link' && !linkUrl) return res.status(400).json({ error: 'Add the link you want to share.' });
  if (postType === 'media' && media.length === 0) return res.status(400).json({ error: 'Upload at least one photo or video.' });

  let circleId = null;
  let community = null;
  if (postType === 'news') {
    if (!NEWS_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Only researchers and staff can post news.' });
    if (!linkUrl) return res.status(400).json({ error: 'News posts need a source link.' });
  } else {
    const slug = clean(req.body.communitySlug, 40);
    if (!slug) return res.status(400).json({ error: 'Choose a community to post in.' });
    community = await prisma.communityCircle.findUnique({ where: { slug } });
    if (!community) return res.status(404).json({ error: 'Community not found.' });
    const membership = await getMembership(req.user.id, community.id);
    if (!canPost(community, membership)) {
      return res.status(403).json({
        error: membership?.status === 'pending'
          ? 'Your join request is still waiting for a moderator.'
          : 'Join this community before posting.',
      });
    }
    circleId = community.id;
  }

  if (expeditionId) {
    const exp = await prisma.expedition.findUnique({ where: { id: expeditionId }, select: { id: true } });
    if (!exp) return res.status(400).json({ error: 'Linked expedition not found.' });
  }

  const post = await prisma.communityPost.create({
    data: {
      title, body, tags, postType, linkUrl: linkUrl || null, media: media.length ? media : undefined,
      circleId, expeditionId, createdBy: req.user.id, score: 1,
      votes: { create: { userId: req.user.id, value: 1 } }, // Reddit auto-upvotes your own post
    },
    include: POST_INCLUDE,
  });

  if (community) {
    const [mods, author] = await Promise.all([
      prisma.communityMembership.findMany({ where: { circleId: community.id, role: 'moderator', status: 'active', userId: { not: req.user.id } }, select: { userId: true } }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } }),
    ]);
    await Promise.all(mods.map((m) => notify({
      userId: m.userId, actorId: req.user.id, type: 'new_post_in_moderated',
      title: `${author?.name || 'Someone'} posted in c/${community.slug}: ${title.slice(0, 80)}`,
      link: `/communities/post/${post.id}`,
    })));
  }

  res.status(201).json(serializePost({ ...post, myVote: 1 }));
});

// PATCH /api/communities/posts/:id — author edits body/tags (title is fixed, like Reddit)
export const updatePost = asyncHandler(async (req, res) => {
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (post.createdBy !== req.user.id) return res.status(403).json({ error: 'You can only edit your own posts.' });
  const data = {};
  if (req.body.body !== undefined) data.body = clean(req.body.body, 40000);
  if (req.body.tags !== undefined) data.tags = cleanTags(req.body.tags);
  const updated = await prisma.communityPost.update({ where: { id: post.id }, data, include: POST_INCLUDE });
  const [withVote] = await attachMyVotes([updated], req.user);
  res.json(serializePost(withVote));
});

// DELETE /api/communities/posts/:id — author, community moderator or staff
export const deletePost = asyncHandler(async (req, res) => {
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  let allowed = post.createdBy === req.user.id || isStaff(req.user);
  if (!allowed && post.circleId) allowed = isModerator(await getMembership(req.user.id, post.circleId), req.user);
  if (!allowed) return res.status(403).json({ error: 'You cannot delete this post.' });
  await prisma.communityPost.delete({ where: { id: post.id } });
  res.json({ deleted: true });
});

// POST /api/communities/posts/:id/vote  { value: 1 | -1 | 0 }
export const votePost = asyncHandler(async (req, res) => {
  const value = [1, -1, 0].includes(Number(req.body.value)) ? Number(req.body.value) : null;
  if (value === null) return res.status(400).json({ error: 'Vote must be 1, -1 or 0.' });
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.id }, include: { circle: true } });
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (post.circle && !canView(post.circle, await getMembership(req.user.id, post.circle.id), req.user)) {
    return res.status(403).json({ error: 'This post is in a private community.' });
  }

  const key = { postId_userId: { postId: post.id, userId: req.user.id } };
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.communityPostVote.findUnique({ where: key });
    const delta = value - (existing?.value || 0);
    if (value === 0) { if (existing) await tx.communityPostVote.delete({ where: key }); }
    else await tx.communityPostVote.upsert({ where: key, update: { value }, create: { postId: post.id, userId: req.user.id, value } });
    return delta === 0 ? post : tx.communityPost.update({ where: { id: post.id }, data: { score: { increment: delta } } });
  });
  res.json({ score: result.score, myVote: value });
});

// ===========================================================================
// Comments
// ===========================================================================

// POST /api/communities/posts/:id/comments  { body, parentId? }
export const addComment = asyncHandler(async (req, res) => {
  const body = clean(req.body.body, 10000);
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const post = await prisma.communityPost.findUnique({ where: { id: req.params.id }, include: { circle: true } });
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (post.circle) {
    const membership = await getMembership(req.user.id, post.circle.id);
    if (!canComment(post.circle, membership, req.user)) {
      return res.status(403).json({ error: post.circle.type === 'private' ? 'Only approved members can comment here.' : 'Join this community to comment.' });
    }
  }

  let parent = null;
  if (req.body.parentId) {
    parent = await prisma.communityComment.findUnique({ where: { id: String(req.body.parentId) } });
    if (!parent || parent.postId !== post.id) return res.status(400).json({ error: 'Reply target not found.' });
  }

  const comment = await prisma.communityComment.create({
    data: { postId: post.id, userId: req.user.id, body, parentId: parent?.id || null, score: 1, votes: { create: { userId: req.user.id, value: 1 } } },
    include: { user: { select: AUTHOR_SELECT } },
  });

  const actorName = comment.user?.name || 'Someone';
  const link = `/communities/post/${post.id}#comment-${comment.id}`;
  if (parent) {
    await notify({ userId: parent.userId, actorId: req.user.id, type: 'comment_reply', title: `${actorName} replied to your comment on "${post.title.slice(0, 60)}"`, link });
  }
  if (!parent || parent.userId !== post.createdBy) {
    await notify({ userId: post.createdBy, actorId: req.user.id, type: 'post_comment', title: `${actorName} commented on your post "${post.title.slice(0, 60)}"`, link });
  }

  res.status(201).json({
    id: comment.id, parentId: comment.parentId, body: comment.body, deleted: false,
    score: comment.score, createdAt: comment.createdAt, user: comment.user, myVote: 1,
  });
});

// DELETE /api/communities/comments/:id — soft delete keeps reply threads intact
export const deleteComment = asyncHandler(async (req, res) => {
  const comment = await prisma.communityComment.findUnique({ where: { id: req.params.id }, include: { post: true } });
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  let allowed = comment.userId === req.user.id || isStaff(req.user);
  if (!allowed && comment.post.circleId) allowed = isModerator(await getMembership(req.user.id, comment.post.circleId), req.user);
  if (!allowed) return res.status(403).json({ error: 'You cannot delete this comment.' });
  await prisma.communityComment.update({ where: { id: comment.id }, data: { deleted: true, body: '' } });
  res.json({ deleted: true });
});

// POST /api/communities/comments/:id/vote  { value }
export const voteComment = asyncHandler(async (req, res) => {
  const value = [1, -1, 0].includes(Number(req.body.value)) ? Number(req.body.value) : null;
  if (value === null) return res.status(400).json({ error: 'Vote must be 1, -1 or 0.' });
  const comment = await prisma.communityComment.findUnique({ where: { id: req.params.id }, include: { post: { include: { circle: true } } } });
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  const circle = comment.post.circle;
  if (circle && !canView(circle, await getMembership(req.user.id, circle.id), req.user)) {
    return res.status(403).json({ error: 'This comment is in a private community.' });
  }
  const key = { commentId_userId: { commentId: comment.id, userId: req.user.id } };
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.communityCommentVote.findUnique({ where: key });
    const delta = value - (existing?.value || 0);
    if (value === 0) { if (existing) await tx.communityCommentVote.delete({ where: key }); }
    else await tx.communityCommentVote.upsert({ where: key, update: { value }, create: { commentId: comment.id, userId: req.user.id, value } });
    return delta === 0 ? comment : tx.communityComment.update({ where: { id: comment.id }, data: { score: { increment: delta } } });
  });
  res.json({ score: result.score, myVote: value });
});

// ===========================================================================
// Media, search, user profiles
// ===========================================================================

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => (error ? reject(error) : resolve(result)));
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// POST /api/communities/media — multipart, field "files" (max 4)
export const uploadMedia = asyncHandler(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files received (field name "files").' });
  const uploaded = [];
  for (const file of files) {
    const isVideo = file.mimetype.startsWith('video/');
    const result = await uploadBuffer(file.buffer, {
      folder: 'ncpor-portal/communities',
      resource_type: isVideo ? 'video' : 'image',
    });
    uploaded.push({
      url: result.secure_url,
      type: isVideo ? 'video' : 'image',
      thumbnailUrl: isVideo
        ? cloudinary.url(result.public_id, { resource_type: 'video', format: 'jpg', secure: true, transformation: [{ width: 640, crop: 'limit', start_offset: 0 }] })
        : cloudinary.url(result.public_id, { secure: true, transformation: [{ width: 640, crop: 'limit', quality: 'auto', fetch_format: 'auto' }] }),
      width: result.width || null,
      height: result.height || null,
    });
  }
  res.status(201).json({ media: uploaded });
});

// GET /api/communities/search?q=&type=all|communities|posts|people&limit=
export const search = asyncHandler(async (req, res) => {
  const q = clean(req.query.q, 100);
  if (q.length < 2) return res.json({ communities: [], posts: [], people: [] });
  const type = req.query.type || 'all';
  const limit = Math.min(Number(req.query.limit) || 5, 25);
  const contains = { contains: q, mode: 'insensitive' };

  const [communities, posts, people] = await Promise.all([
    type === 'all' || type === 'communities'
      ? prisma.communityCircle.findMany({ where: { AND: [await visibleCommunityWhere(req.user), { OR: [{ name: contains }, { description: contains }, { topic: contains }] }] }, take: limit, include: COMMUNITY_COUNTS, orderBy: { memberships: { _count: 'desc' } } })
      : [],
    type === 'all' || type === 'posts'
      ? prisma.communityPost.findMany({
        where: { AND: [{ status: 'published' }, await visibilityFilter(req.user), { OR: [{ title: contains }, { body: contains }] }] },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        include: POST_INCLUDE,
      })
      : [],
    type === 'all' || type === 'people'
      ? prisma.user.findMany({
        where: { accountStatus: 'active', role: { not: 'public' }, OR: [{ name: contains }, { organization: contains }] },
        select: { id: true, name: true, organization: true, avatarUrl: true, role: true },
        take: limit,
      })
      : [],
  ]);

  // Tag matches are filtered in memory (tags is JSON) from the text results
  // plus a small extra pass so "#seaice" style searches still land.
  let tagPosts = [];
  if (type === 'all' || type === 'posts') {
    const needle = q.replace(/^#/, '').toLowerCase();
    const recent = await prisma.communityPost.findMany({
      where: { AND: [{ status: 'published' }, await visibilityFilter(req.user)] },
      orderBy: { createdAt: 'desc' }, take: 300, include: POST_INCLUDE,
    });
    tagPosts = recent.filter((p) => Array.isArray(p.tags) && p.tags.some((t) => String(t).toLowerCase().includes(needle)));
  }
  const merged = [...new Map([...posts, ...tagPosts].map((p) => [p.id, p])).values()].slice(0, limit);

  res.json({
    communities: communities.map((c) => serializeCommunity(c)),
    posts: (await attachMyVotes(merged, req.user)).map(serializePost),
    people,
  });
});

// GET /api/communities/users/:id — public community profile (u/ page)
export const getUserProfile = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, name: true, role: true, organization: true, designation: true, avatarUrl: true, createdAt: true, bio: true,
      email: true, mobileNumber: true, showEmail: true, showMobile: true,
      linkedinUrl: true, twitterUrl: true, researchGateUrl: true, orcidId: true, githubUrl: true, personalProfileUrl: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const [postKarma, commentKarma, postCount, moderates] = await Promise.all([
    prisma.communityPost.aggregate({ where: { createdBy: user.id }, _sum: { score: true } }),
    prisma.communityComment.aggregate({ where: { userId: user.id, deleted: false }, _sum: { score: true } }),
    prisma.communityPost.count({ where: { createdBy: user.id } }),
    prisma.communityMembership.findMany({
      where: { userId: user.id, role: 'moderator', status: 'active', circle: { type: { not: 'private' } } },
      include: { circle: { select: { slug: true, name: true, iconColor: true } } },
    }),
  ]);
  const { email, mobileNumber, showEmail, showMobile, ...rest } = user;
  res.json({
    ...rest,
    email: showEmail ? email : null,
    mobileNumber: showMobile ? mobileNumber : null,
    karma: (postKarma._sum.score || 0) + (commentKarma._sum.score || 0),
    postCount,
    moderates: moderates.map((m) => m.circle),
  });
});
