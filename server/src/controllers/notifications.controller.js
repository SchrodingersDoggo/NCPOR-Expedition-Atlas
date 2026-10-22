import prisma from '../config/prisma.js';

// GET /api/notifications?limit=20&before=<ISO>
export const listNotifications = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const before = req.query.before ? new Date(req.query.before) : null;
    const rows = await prisma.notification.findMany({
      where: { userId: req.user.id, ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: {
        id: true, type: true, title: true, link: true, readAt: true, createdAt: true,
        actor: { select: { id: true, name: true } },
      },
    });
    res.json({ notifications: rows.slice(0, limit), hasMore: rows.length > limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/notifications/summary — two integers, deliberately tiny so the
// Communities header can check it occasionally even on a slow link.
export const summary = async (req, res) => {
  try {
    const [notifications, messages] = await Promise.all([
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
      prisma.directMessage.count({ where: { receiverId: req.user.id, readAt: null } }),
    ]);
    res.json({ notifications, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/notifications/:id/read
export const markRead = async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/notifications/read-all
export const markAllRead = async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
