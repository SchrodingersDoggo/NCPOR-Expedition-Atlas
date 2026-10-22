import express from 'express';
import * as controller from '../controllers/datasetAccess.controller.js';
import { authenticate, requireActiveAccount, authorize } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/', authenticate, requireActiveAccount, controller.createAccessRequest);
router.get('/', authenticate, controller.listAccessRequests);
router.patch('/:id/status', authenticate, authorize('admin', 'comms_officer'), controller.setAccessRequestStatus);

export default router;
