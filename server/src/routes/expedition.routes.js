import express from 'express';
import * as expeditionController from '../controllers/expedition.controller.js';
import * as alertController from '../controllers/alert.controller.js';
import { authenticate, authorize, requireActiveAccount } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', expeditionController.listExpeditions);
router.get('/:id', expeditionController.getExpeditionById);
router.post('/', authenticate, requireActiveAccount, authorize('researcher', 'comms_officer', 'admin'), expeditionController.createExpedition);
router.patch('/:id', authenticate, requireActiveAccount, authorize('researcher', 'comms_officer', 'admin'), expeditionController.updateExpedition);
router.delete('/:id', authenticate, requireActiveAccount, authorize('comms_officer', 'admin'), expeditionController.deleteExpedition);

// Emergency Alert — Phase 1
router.get('/:id/alerts', authenticate, authorize('researcher', 'comms_officer', 'admin'), alertController.listAlerts);
router.post('/:id/alerts', authenticate, requireActiveAccount, authorize('researcher', 'comms_officer', 'admin'), alertController.createAlert);
// Phase 5 — resolving (and thus de-escalating the danger level) is
// deliberately narrower than reporting: only admin/comms_officer.
router.patch('/:id/alerts/:alertId/resolve', authenticate, requireActiveAccount, authorize('comms_officer', 'admin'), alertController.resolveAlert);

export default router;
