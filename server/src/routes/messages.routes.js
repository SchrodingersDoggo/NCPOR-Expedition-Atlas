import express from 'express';
import * as controller from '../controllers/messages.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

// Every messaging route requires a valid JWT. /conversations must stay
// above /:userId so it is not captured as a user id.
router.get('/conversations', authenticate, controller.listConversations);
router.get('/:userId', authenticate, controller.getConversation);
router.post('/:userId', authenticate, controller.sendMessage);
router.patch('/:userId/read', authenticate, controller.markConversationRead);

export default router;
