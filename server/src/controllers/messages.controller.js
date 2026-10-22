import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';

// ---------------------------------------------------------------------------
// Direct messages — private 1:1, text only, REST + client polling.
//
// Security model: the logged-in user always comes from the verified JWT
// (req.user.id). Every query is scoped so it can only ever touch rows where
// that user is the sender or the receiver. senderId is never read from the
// request body.
//
// Bandwidth model (portal must work around ~9 KB/s):
//   - message rows are 5 small fields, no user objects repeated per row
//   - polls use ?after=<lastMessageId> so only new messages come back
//   - the inbox poll uses ?since=<serverTime> so it is usually an empty list
// ---------------------------------------------------------------------------

const MAX_LENGTH = 2000;
const PAGE_SIZE = 40;
const RATE_LIMIT_PER_MINUTE = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGE_SELECT = { id: true, senderId: true, body: true, createdAt: true, readAt: true };
const USER_SELECT = { id: true, name: true, organization: true, avatarUrl: true, role: true };

function badId(res) {
  return res.status(400).json({ error: 'Invalid user id.' });
}

// GET /api/messages/conversations?since=<ISO>
// Without `since`: the full inbox (latest message per conversation).
// With `since`: only conversations that received a message after that time.
export const listConversations = async (req, res) => {
  try {
    const me = req.user.id;
    const since = req.query.since ? new Date(req.query.since) : null;
    const sinceValid = since && !Number.isNaN(since.getTime());
    const serverTime = new Date().toISOString();

    const rows = await prisma.$queryRaw`
      SELECT * FROM (
        SELECT DISTINCT ON (other_id)
          other_id, id, body, sender_id, created_at
        FROM (
          SELECT CASE WHEN sender_id = ${me} THEN receiver_id ELSE sender_id END AS other_id,
                 id, body, sender_id, created_at
          FROM direct_messages
          WHERE sender_id = ${me} OR receiver_id = ${me}
        ) conv
        ORDER BY other_id, created_at DESC
      ) latest
      ${sinceValid ? Prisma.sql`WHERE created_at > ${since}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT 200
    `;

    const filtered = rows;
    if (filtered.length === 0) return res.json({ conversations: [], serverTime });

    const otherIds = filtered.map((r) => r.other_id);
    const [users, unread] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: otherIds } }, select: USER_SELECT }),
      prisma.directMessage.groupBy({
        by: ['senderId'],
        where: { receiverId: me, readAt: null, senderId: { in: otherIds } },
        _count: { _all: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const unreadById = new Map(unread.map((u) => [u.senderId, u._count._all]));

    res.json({
      serverTime,
      conversations: filtered
        .filter((r) => userById.has(r.other_id))
        .map((r) => ({
          user: userById.get(r.other_id),
          lastMessage: {
            id: r.id,
            preview: r.body.length > 90 ? `${r.body.slice(0, 90)}…` : r.body,
            fromMe: r.sender_id === me,
            createdAt: r.created_at,
          },
          unreadCount: unreadById.get(r.other_id) || 0,
        })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/messages/:userId            → latest PAGE_SIZE messages (+ other user's info)
// GET /api/messages/:userId?after=<id>  → only messages newer than <id> (polling)
// GET /api/messages/:userId?before=<id> → older page (scroll up)
export const getConversation = async (req, res) => {
  try {
    const me = req.user.id;
    const other = req.params.userId;
    if (!UUID_RE.test(other)) return badId(res);
    if (other === me) return res.status(400).json({ error: 'You cannot message yourself.' });

    // The only rows this query can ever see: me→other and other→me.
    const scope = {
      OR: [
        { senderId: me, receiverId: other },
        { senderId: other, receiverId: me },
      ],
    };

    // Resolve an ?after / ?before cursor — but only if that message is part
    // of THIS conversation, so ids from other conversations reveal nothing.
    async function cursorTime(id) {
      if (!id || !UUID_RE.test(id)) return null;
      const msg = await prisma.directMessage.findFirst({ where: { id, ...scope }, select: { createdAt: true } });
      return msg?.createdAt || null;
    }

    if (req.query.after) {
      const t = await cursorTime(req.query.after);
      if (!t) return res.json({ messages: [] });
      const messages = await prisma.directMessage.findMany({
        where: { AND: [scope, { createdAt: { gte: t } }, { id: { not: req.query.after } }] },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: MESSAGE_SELECT,
      });
      return res.json({ messages });
    }

    let beforeFilter = {};
    if (req.query.before) {
      const t = await cursorTime(req.query.before);
      if (!t) return res.json({ messages: [], hasMore: false });
      beforeFilter = { createdAt: { lt: t } };
    }

    const rows = await prisma.directMessage.findMany({
      where: { AND: [scope, beforeFilter] },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE + 1,
      select: MESSAGE_SELECT,
    });
    const hasMore = rows.length > PAGE_SIZE;
    const messages = rows.slice(0, PAGE_SIZE).reverse();

    if (req.query.before) return res.json({ messages, hasMore });

    const user = await prisma.user.findUnique({ where: { id: other }, select: USER_SELECT });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user, messages, hasMore });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/messages/:userId  { body }
export const sendMessage = async (req, res) => {
  try {
    const me = req.user.id;
    const other = req.params.userId;
    if (!UUID_RE.test(other)) return badId(res);
    if (other === me) return res.status(400).json({ error: 'You cannot message yourself.' });

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
    if (body.length > MAX_LENGTH) return res.status(400).json({ error: `Messages can be at most ${MAX_LENGTH} characters.` });

    const receiver = await prisma.user.findUnique({ where: { id: other }, select: { id: true, accountStatus: true } });
    if (!receiver || ['suspended', 'rejected'].includes(receiver.accountStatus)) {
      return res.status(404).json({ error: 'This user cannot receive messages.' });
    }

    const recent = await prisma.directMessage.count({
      where: { senderId: me, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recent >= RATE_LIMIT_PER_MINUTE) {
      return res.status(429).json({ error: 'You are sending messages too quickly. Please wait a moment.' });
    }

    const message = await prisma.directMessage.create({
      data: { senderId: me, receiverId: other, body }, // senderId from the JWT only
      select: MESSAGE_SELECT,
    });
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/messages/:userId/read — marks messages FROM that user TO me as read.
export const markConversationRead = async (req, res) => {
  try {
    const other = req.params.userId;
    if (!UUID_RE.test(other)) return badId(res);
    const result = await prisma.directMessage.updateMany({
      where: { senderId: other, receiverId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
