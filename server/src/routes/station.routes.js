import express from 'express';
import * as controller from '../controllers/station.controller.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', controller.listStations);
router.post('/', authenticate, authorize('admin', 'comms_officer'), controller.createStation);
router.patch('/:id', authenticate, authorize('admin', 'comms_officer'), controller.updateStation);
router.delete('/:id', authenticate, authorize('admin', 'comms_officer'), controller.deleteStation);

export default router;
