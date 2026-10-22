import express from 'express';
import multer from 'multer';
import * as usersController from '../controllers/users.controller.js';
import { avatarUpload } from '../middleware/upload.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

// Everything here is about the logged-in user's own profile, so every
// route requires a valid token — no optionalAuth/anonymous access.
router.get('/me', authenticate, usersController.getMe);
router.patch('/me', authenticate, usersController.updateMe);

// POST /api/users/me/avatar — multipart/form-data, field name "avatar"
router.post(
  '/me/avatar',
  authenticate,
  (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'Image too large (max 5MB)' });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  usersController.uploadAvatar
);

export default router;
