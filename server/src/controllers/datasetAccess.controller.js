import prisma from '../config/prisma.js';

const isStaff = (req) => ['admin', 'comms_officer'].includes(req.user.role);

// POST /api/dataset-access-requests — any active user requests access to
// a request_required or restricted dataset. Idempotent-ish: re-requesting
// an existing pending/approved request just returns it rather than erroring.
export const createAccessRequest = async (req, res) => {
  const { content_item_id } = req.body;
  if (!content_item_id) return res.status(400).json({ error: 'content_item_id is required' });
  try {
    const dataset = await prisma.contentItem.findUnique({ where: { id: content_item_id } });
    if (!dataset) return res.status(404).json({ error: 'Dataset not found' });
    if (!['request_required', 'restricted'].includes(dataset.accessLevel)) {
      return res.status(400).json({ error: 'This dataset does not require an access request.' });
    }

    const existing = await prisma.datasetAccessRequest.findUnique({
      where: { userId_contentItemId: { userId: req.user.id, contentItemId: content_item_id } },
    });
    if (existing) return res.status(200).json(existing);

    const request = await prisma.datasetAccessRequest.create({
      data: { userId: req.user.id, contentItemId: content_item_id },
    });
    res.status(201).json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/dataset-access-requests — a user's own requests, or (staff
// only) everyone's, optionally filtered by status.
export const listAccessRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const where = {
      ...(status && { status }),
      ...(!isStaff(req) && { userId: req.user.id }),
    };
    const requests = await prisma.datasetAccessRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, organization: true, role: true } },
        dataset: { select: { id: true, title: true, type: true, accessLevel: true } },
        reviewer: { select: { id: true, name: true } },
      },
    });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/dataset-access-requests/:id/status — admin/comms_officer only.
export const setAccessRequestStatus = async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved, rejected, or pending' });
  }
  try {
    const request = await prisma.datasetAccessRequest.update({
      where: { id: req.params.id },
      data: { status, reviewedBy: req.user.id, reviewedAt: new Date() },
      include: {
        user: { select: { id: true, name: true } },
        dataset: { select: { id: true, title: true } },
      },
    });
    res.json(request);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};
