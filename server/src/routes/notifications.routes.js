import express from 'express';
import * as controller from '../controllers/notifications.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();
router.get('/', authenticate, controller.listNotifications);
router.get('/summary', authenticate, controller.summary);
router.patch('/read-all', authenticate, controller.markAllRead);
router.patch('/:id/read', authenticate, controller.markRead);

export default router;
