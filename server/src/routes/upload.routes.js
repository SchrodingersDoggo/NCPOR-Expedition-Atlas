import express from 'express';
import multer from 'multer';
import * as uploadController from '../controllers/upload.controller.js';
import { upload } from '../middleware/upload.middleware.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';

const router = express.Router();

// POST /api/upload — multipart/form-data, field name "file"
router.post(
  '/',
  authenticate,
  authorize('researcher', 'comms_officer', 'admin'),
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large (max 100MB)' });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  uploadController.uploadFile
);

export default router;
