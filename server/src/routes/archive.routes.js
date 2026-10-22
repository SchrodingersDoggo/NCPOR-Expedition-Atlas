import express from 'express';
import * as archiveController from '../controllers/archive.controller.js';
import { authenticate, authorize, optionalAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Public (optionalAuth so staff get to see pending/in-review when they
// explicitly ask for it via ?status=) --------------------------------
router.get('/search', optionalAuth, archiveController.searchArchive);
router.get('/timeline', optionalAuth, archiveController.getTimeline);
router.get('/facets', optionalAuth, archiveController.getFacets);
router.get('/items/:id', optionalAuth, archiveController.getArchiveItem);

// Submission tracking — any signed-in uploader can see their own; staff
// see everything. Enforced inside the controller, same pattern as the
// rest of the portal's role system.
router.get(
  '/submissions',
  authenticate,
  authorize('researcher', 'comms_officer', 'admin'),
  archiveController.listSubmissions
);

// Submission queue / status changes — admin & comms_officer only, same
// roles that already gate the existing Review Queue.
router.get('/queue', authenticate, authorize('comms_officer', 'admin'), archiveController.getQueue);
router.patch(
  '/submissions/:id/status',
  authenticate,
  authorize('comms_officer', 'admin'),
  archiveController.updateSubmissionStatus
);
router.patch(
  '/submissions/:id/priority',
  authenticate,
  authorize('comms_officer', 'admin'),
  archiveController.updateSubmissionPriority
);

export default router;
