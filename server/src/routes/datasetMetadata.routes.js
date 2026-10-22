import express from 'express';
import * as controller from '../controllers/datasetMetadata.controller.js';
import { authenticate, authorize, optionalAuth, requireActiveAccount } from '../middleware/auth.middleware.js';

const router = express.Router();

// Order matters: /mine must be registered before /:id or Express will try
// to treat "mine" as an :id param.
router.get('/mine', authenticate, controller.listMyDatasetMetadata);
router.get('/queue', authenticate, authorize('admin', 'comms_officer'), controller.listMetadataQueue);

router.post('/', authenticate, requireActiveAccount, authorize('researcher', 'comms_officer', 'admin'), controller.createDatasetMetadata);
router.get('/:id', optionalAuth, controller.getDatasetMetadataById);
router.patch('/:id', authenticate, requireActiveAccount, controller.updateDatasetMetadata);
// Not staff-only at the route level: the controller itself checks
// permissions per action (reviewer actions are staff-only, but "resubmit"
// is the record's own researcher acting on their own changes_requested
// record — see REVIEW_ACTIONS in the controller).
router.patch('/:id/status', authenticate, requireActiveAccount, controller.updateDatasetMetadataStatus);
router.get('/:id/review-history', authenticate, controller.getMetadataReviewHistory);

// One metadata record, many files: add another file at any time (raw
// today, processed next week, a calibration PDF after that — no limit),
// or remove one without touching the record or its other files.
router.post('/:id/files', authenticate, requireActiveAccount, controller.addFileToMetadata);
router.delete('/:id/files/:fileId', authenticate, requireActiveAccount, controller.removeFileFromMetadata);

export default router;
