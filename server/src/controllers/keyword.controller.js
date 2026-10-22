import prisma from '../config/prisma.js';

const isStaff = (req) => !!req.user && ['admin', 'comms_officer'].includes(req.user.role);

// GET /api/keywords?status=approved
// Public/researcher callers only ever see 'approved' terms — this is what
// backs the Scientific Keywords autocomplete on Upload and the "Browse by
// Scientific Keywords" filter on Archive, both of which should only ever
// offer the controlled, admin-accepted vocabulary. Staff can pass
// status=pending to see the suggestion queue, or status=all for everything.
export const listKeywords = async (req, res) => {
  try {
    const requested = req.query.status;
    const status = isStaff(req) && requested && requested !== 'all' ? requested : undefined;
    const where = isStaff(req)
      ? (status ? { status } : {})
      : { status: 'approved' };

    const tags = await prisma.tag.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: {
        suggester: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/keywords — admin/comms_officer only. Adds a term directly to
// the controlled vocabulary, pre-approved (an admin curating the accepted
// list up front, as opposed to a researcher's suggestion arriving via
// content upload, which content.controller.js / datasetMetadata.controller.js
// create as 'pending' instead of going through this endpoint).
export const createKeyword = async (req, res) => {
  const name = String(req.body.name || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: { status: 'approved', reviewedBy: req.user.id },
      create: { name, status: 'approved', reviewedBy: req.user.id },
    });
    res.status(201).json(tag);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/keywords/:id/status — admin/comms_officer approves or rejects
// a researcher-suggested term. This is the moderation step: a rejected
// term stays in the table (so the same word isn't re-suggested endlessly
// without a record of the decision) but never appears in the approved-only
// listKeywords result, so it drops out of every facet/autocomplete.
export const setKeywordStatus = async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved, rejected, or pending' });
  }
  try {
    const tag = await prisma.tag.update({
      where: { id: parseInt(req.params.id, 10) },
      data: { status, reviewedBy: req.user.id },
    });
    res.json(tag);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/keywords/:id — admin/comms_officer only, and only when the
// term isn't attached to anything, so removing a bad suggestion never
// silently detaches it from content someone already tagged.
export const deleteKeyword = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const usage = await prisma.contentTag.count({ where: { tagId: id } });
    if (usage > 0) {
      return res.status(409).json({ error: `This keyword is used by ${usage} item(s) and can't be deleted.` });
    }
    await prisma.tag.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};
