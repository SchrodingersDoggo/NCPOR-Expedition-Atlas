import express from 'express';
import * as controller from '../controllers/keyword.controller.js';
import { authenticate, authorize, optionalAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', optionalAuth, controller.listKeywords);
router.post('/', authenticate, authorize('admin', 'comms_officer'), controller.createKeyword);
router.patch('/:id/status', authenticate, authorize('admin', 'comms_officer'), controller.setKeywordStatus);
router.delete('/:id', authenticate, authorize('admin', 'comms_officer'), controller.deleteKeyword);

export default router;
