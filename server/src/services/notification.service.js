import prisma from '../config/prisma.js';

// Creates one in-app notification. Never notifies someone about their own
// action, and never throws — a failed notification must not fail the
// request that triggered it (posting a comment, approving a member...).
export async function notify({ userId, actorId = null, type, title, link = null }) {
  if (!userId || userId === actorId) return null;
  try {
    return await prisma.notification.create({
      data: { userId, actorId, type, title: String(title).slice(0, 240), link },
    });
  } catch (err) {
    console.error('[notify] failed:', err.message);
    return null;
  }
}
