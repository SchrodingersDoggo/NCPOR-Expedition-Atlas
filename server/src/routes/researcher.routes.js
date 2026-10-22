import express from 'express';
import * as researcherController from '../controllers/researcher.controller.js';

const router = express.Router();
router.get('/', researcherController.listResearchers);
router.get('/:id', researcherController.getResearcher);

export default router;
