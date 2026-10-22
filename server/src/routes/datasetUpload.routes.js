import express from 'express';
import {
  authenticate,
  authorize,
  requireActiveAccount,
} from '../middleware/auth.middleware.js';
import * as controller from '../controllers/datasetUpload.controller.js';

const router = express.Router();

// Phase 3: metadata/control-plane API only. Dataset bytes never enter Express.
router.use(
  authenticate,
  requireActiveAccount,
  authorize('researcher', 'comms_officer', 'admin')
);

router.post('/init', controller.initDatasetUpload);
router.post('/part-url', controller.getPartUploadUrl);
router.get('/status', controller.getDatasetUploadStatus);
router.post('/complete', controller.completeDatasetUpload);
router.delete('/abort', controller.abortDatasetUpload);
router.post('/session-token', controller.reissueDatasetUploadSessionToken);
router.post('/cleanup-stale', controller.cleanupStaleDatasetUploads);

export default router;
