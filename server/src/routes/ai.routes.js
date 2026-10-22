import express from 'express';
import * as aiController from '../controllers/ai.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/generate', authenticate, authorize('researcher', 'comms_officer', 'admin'), aiController.generate);
// Editing is open to researchers too now (they can edit a summary they
// generated for their own not-yet-submitted or own content), but
// ownership is enforced inside the controller — comms_officer/admin can
// edit anything, a researcher only their own.
router.patch('/:id/edit', authenticate, authorize('researcher', 'comms_officer', 'admin'), aiController.editGeneration);
router.patch('/:id/publish', authenticate, authorize('comms_officer', 'admin'), aiController.publishGeneration);

export default router;
