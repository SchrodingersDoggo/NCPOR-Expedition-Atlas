import express from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import * as studio from '../controllers/studio.controller.js';

const router = express.Router();
router.post('/webhooks/creatomate', studio.creatomateWebhook);
router.use(authenticate, authorize('researcher'));
router.get('/projects', studio.listProjects);
router.get('/voiceover-languages', studio.listVoiceoverLanguages);
router.post('/projects', studio.createProject);
router.get('/projects/:id', studio.getProject);
router.post('/projects/:id/generate', studio.generateProject);
router.patch('/projects/:id', studio.updateProject);
router.delete('/projects/:id/generated', studio.deleteGenerated);
router.delete('/projects/:id', studio.deleteProject);
export default router;
