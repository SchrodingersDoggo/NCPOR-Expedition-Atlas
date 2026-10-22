import express from 'express';
import * as contentController from '../controllers/content.controller.js';
import { authenticate, authorize, optionalAuth, requireActiveAccount } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', contentController.listContent);
router.post('/', authenticate, requireActiveAccount, authorize('researcher', 'comms_officer', 'admin'), contentController.createContent);
router.patch('/:id/status', authenticate, requireActiveAccount, authorize('comms_officer', 'admin'), contentController.updateContentStatus);
router.patch('/:id', authenticate, requireActiveAccount, authorize('comms_officer', 'admin'), contentController.updateContent);
router.get('/:id/access', optionalAuth, contentController.getContentAccess);
router.get('/:id/download', optionalAuth, contentController.getContentDownload);
router.get('/:id', optionalAuth, contentController.getContentById);

export default router;
