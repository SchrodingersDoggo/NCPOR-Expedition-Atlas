import express from 'express';
import * as alertController from '../controllers/alert.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

const router = express.Router();

// GET /api/alerts?since=<ISO timestamp>
// Any signed-in team member can be on the receiving end of a danger report,
// so this isn't scoped to a single expedition or a specific role beyond
// "signed in" the way the per-expedition alert routes are.
router.get('/', authenticate, authorize('researcher', 'comms_officer', 'admin'), alertController.listRecentAlerts);

export default router;
