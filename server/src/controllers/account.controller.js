import prisma from '../config/prisma.js';

const ACCOUNT_SELECT = {
  id: true, name: true, email: true, role: true, accountStatus: true,
  title: true, firstName: true, lastName: true, preferredName: true,
  designation: true, organization: true, organisationWebsite: true,
  personalProfileUrl: true, communicationAddress: true, alternateEmail: true,
  mobileNumber: true, createdAt: true, approvedAt: true,
  approver: { select: { id: true, name: true } },
};

// GET /api/accounts?status=pending — admin/comms_officer only.
// No status param returns everyone (paged in a real deployment; a small
// hackathon user base doesn't need pagination yet).
export const listAccounts = async (req, res) => {
  try {
    const { status } = req.query;
    const users = await prisma.user.findMany({
      where: status ? { accountStatus: status } : {},
      orderBy: [{ accountStatus: 'asc' }, { createdAt: 'desc' }],
      select: ACCOUNT_SELECT,
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const VALID_STATUSES = ['pending', 'active', 'suspended', 'rejected'];

// PATCH /api/accounts/:id/status — admin/comms_officer only. Covers
// approve (pending -> active), reject (-> rejected), suspend (-> suspended),
// and reactivate (-> active) — all the same "set the status" operation,
// distinguished only by which status the caller sends.
export const setAccountStatus = async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        accountStatus: status,
        approvedBy: req.user.id,
        approvedAt: new Date(),
      },
      select: ACCOUNT_SELECT,
    });
    res.json(user);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};

const ASSIGNABLE_ROLES = ['public', 'researcher', 'comms_officer', 'admin'];

// PATCH /api/accounts/:id/role — admin ONLY (not comms_officer — role
// assignment is a stricter action than account approval). A user can never
// change their own role, even an admin acting on their own account id.
export const setAccountRole = async (req, res) => {
  const { role } = req.body;
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` });
  }
  if (req.params.id === req.user.id) {
    return res.status(403).json({ error: 'You cannot change your own role.' });
  }
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: ACCOUNT_SELECT,
    });
    res.json(user);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};
