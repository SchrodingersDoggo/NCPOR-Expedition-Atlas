import express from 'express';
import * as controller from '../controllers/account.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

const router = express.Router();

// Note: account approval/suspension deliberately does NOT require
// requireActiveAccount on the caller beyond role — an admin/comms_officer
// account is always active by definition of having that role assigned
// (role assignment itself is admin-only and happens after approval).
router.get('/', authenticate, authorize('admin', 'comms_officer'), controller.listAccounts);
router.patch('/:id/status', authenticate, authorize('admin', 'comms_officer'), controller.setAccountStatus);
router.patch('/:id/role', authenticate, authorize('admin'), controller.setAccountRole);

export default router;
