import prisma from '../config/prisma.js';

const researcherWhere = { role: 'researcher' };

function sanitizePublicContentItem(item) {
  if (!item || item.type !== 'dataset') return item;
  const { objectKey, wholeFileSha256, ...rest } = item;
  return { ...rest, fileUrl: null };
}

function uniqueById(items) {
  const map = new Map(items.map((item) => [item.id, item]));
  return [...map.values()];
}

async function getResearcherContent(userId) {
  return prisma.contentItem.findMany({
    where: { uploadedBy: userId, status: 'published' },
    orderBy: { createdAt: 'desc' },
    include: {
      expedition: { select: { id: true, name: true, region: true, startDate: true, endDate: true } },
    },
  });
}

function buildStats(content, expeditions) {
  const linkedExpeditionIds = content.map((item) => item.expeditionId).filter(Boolean);
  const expeditionCount = new Set([
    ...expeditions.map((item) => item.id),
    ...linkedExpeditionIds,
  ]).size;

  return {
    expeditions: expeditionCount,
    datasets: content.filter((item) => item.type === 'dataset').length,
    photos: content.filter((item) => item.type === 'photo').length,
    reports: content.filter((item) => ['report', 'publication'].includes(item.type)).length,
    videos: content.filter((item) => item.type === 'video').length,
    activities: content.filter((item) => item.type === 'activity').length,
  };
}

function toPublicCard(user, stats) {
  return {
    id: user.id,
    name: user.name,
    organization: user.organization,
    avatarUrl: user.avatarUrl,
    stats,
  };
}

// GET /api/researchers
export const listResearchers = async (req, res) => {
  try {
    const researchers = await prisma.user.findMany({
      where: researcherWhere,
      select: { id: true, name: true, organization: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    });

    const cards = await Promise.all(researchers.map(async (researcher) => {
      const [expeditions, content] = await Promise.all([
        prisma.expedition.findMany({ where: { principalInvestigator: researcher.id }, select: { id: true } }),
        prisma.contentItem.findMany({ where: { uploadedBy: researcher.id, status: 'published' }, select: { id: true, expeditionId: true, type: true } }),
      ]);
      return toPublicCard(researcher, buildStats(content, expeditions));
    }));

    res.json({ researchers: cards });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load researchers' });
  }
};

// GET /api/researchers/:id
export const getResearcher = async (req, res) => {
  try {
    const found = await prisma.user.findFirst({
      where: { id: req.params.id, ...researcherWhere },
      select: {
        id: true, name: true, email: true, organization: true, avatarUrl: true, createdAt: true,
        // Communities update — contact section on the researcher profile.
        designation: true, bio: true, linkedinUrl: true, twitterUrl: true, researchGateUrl: true,
        orcidId: true, githubUrl: true, personalProfileUrl: true, mobileNumber: true,
        showEmail: true, showMobile: true,
      },
    });

    if (!found) return res.status(404).json({ error: 'Researcher not found' });

    // Email / phone are only exposed when the researcher opted in.
    const { showEmail, showMobile, email, mobileNumber, ...publicFields } = found;
    const researcher = {
      ...publicFields,
      email: showEmail ? email : null,
      mobileNumber: showMobile ? mobileNumber : null,
    };

    const [ledExpeditions, content] = await Promise.all([
      prisma.expedition.findMany({
        where: { principalInvestigator: researcher.id },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      }),
      getResearcherContent(researcher.id),
    ]);

    const linkedIds = content.map((item) => item.expeditionId).filter(Boolean);
    const linkedExpeditions = linkedIds.length
      ? await prisma.expedition.findMany({ where: { id: { in: linkedIds } } })
      : [];

    const expeditions = uniqueById([...ledExpeditions, ...linkedExpeditions]).sort((a, b) => {
      const ad = a.startDate ? new Date(a.startDate).getTime() : 0;
      const bd = b.startDate ? new Date(b.startDate).getTime() : 0;
      return bd - ad;
    });

    const stats = buildStats(content, ledExpeditions);
    const safeContent = content.map(sanitizePublicContentItem);
    const grouped = {
      datasets: safeContent.filter((item) => item.type === 'dataset'),
      photos: safeContent.filter((item) => item.type === 'photo'),
      reports: safeContent.filter((item) => ['report', 'publication'].includes(item.type)),
      videos: safeContent.filter((item) => item.type === 'video'),
      activities: safeContent.filter((item) => item.type === 'activity'),
    };

    res.json({ researcher, stats, expeditions, content: grouped });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load researcher' });
  }
};
