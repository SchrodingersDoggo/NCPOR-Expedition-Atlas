import express from 'express';
import * as controller from '../controllers/activities.controller.js';
import { authenticate, authorize, optionalAuth } from '../middleware/auth.middleware.js';

const router = express.Router();
router.get('/overview', optionalAuth, controller.getOverview);
router.get('/institutional', controller.listInstitutionalActivities);
router.post('/institutional', authenticate, authorize('admin', 'comms_officer'), controller.createInstitutionalActivity);
router.get('/observations', controller.listObservations);
router.post('/observations', authenticate, authorize('researcher', 'comms_officer', 'admin'), controller.createObservation);
router.get('/community/posts', optionalAuth, controller.listPosts);
router.post('/community/posts', authenticate, controller.createPost);
router.delete('/community/posts/:id', authenticate, controller.deletePost);
router.post('/community/circles/:id/join', authenticate, controller.joinCircle);
router.delete('/community/circles/:id/leave', authenticate, controller.leaveCircle);
router.post('/community/posts/:id/like', authenticate, controller.toggleLike);
router.post('/community/posts/:id/comments', authenticate, controller.addComment);
router.patch('/community/posts/:id/verify', authenticate, authorize('comms_officer', 'admin'), controller.verifyPost);
export default router;
