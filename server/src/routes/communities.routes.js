import express from 'express';
import multer from 'multer';
import * as c from '../controllers/communities.controller.js';
import { authenticate, optionalAuth, requireActiveAccount } from '../middleware/auth.middleware.js';
import { communityMediaUpload } from '../middleware/upload.middleware.js';
import { createRateLimit } from '../middleware/rateLimit.middleware.js';

const router = express.Router();

// Reading is open (private communities are filtered inside the controller);
// every write needs a logged-in user, and creating content needs an
// approved (active) account — same rule as the rest of the portal.
const write = [authenticate, requireActiveAccount];

const createCommunityLimit = createRateLimit({ name: 'community-create', windowMs: 60 * 60 * 1000, max: 5, message: 'Too many communities created recently. Please try again later.' });
const joinLimit = createRateLimit({ name: 'community-join', windowMs: 10 * 60 * 1000, max: 30 });
const postLimit = createRateLimit({ name: 'community-post', windowMs: 10 * 60 * 1000, max: 30 });
const commentLimit = createRateLimit({ name: 'community-comment', windowMs: 10 * 60 * 1000, max: 60 });
const mediaLimit = createRateLimit({ name: 'community-media', windowMs: 10 * 60 * 1000, max: 12, message: 'Too many media uploads. Please wait a few minutes and try again.' });
const searchLimit = createRateLimit({ name: 'community-search', windowMs: 60 * 1000, max: 90 });

// Communities
router.get('/', optionalAuth, c.listCommunities);
router.get('/mine', authenticate, c.myCommunities);
router.post('/', ...write, createCommunityLimit, c.createCommunity);
router.get('/c/:slug', optionalAuth, c.getCommunity);
router.patch('/c/:slug', ...write, c.updateCommunity);
router.post('/c/:slug/join', authenticate, joinLimit, c.joinCommunity);
router.delete('/c/:slug/leave', authenticate, c.leaveCommunity);
router.patch('/c/:slug/favorite', authenticate, c.setFavorite);
router.get('/c/:slug/members', authenticate, c.listMembers);
router.post('/c/:slug/members/:userId/approve', authenticate, c.approveMember);
router.post('/c/:slug/members/:userId/moderator', authenticate, c.makeModerator);
router.delete('/c/:slug/members/:userId/moderator', authenticate, c.removeModerator);
router.delete('/c/:slug/members/:userId', authenticate, c.removeMember);

// Feed & posts
router.get('/feed', optionalAuth, c.getFeed);
router.post('/posts', ...write, postLimit, c.createPost);
router.get('/posts/:id', optionalAuth, c.getPost);
router.patch('/posts/:id', ...write, c.updatePost);
router.delete('/posts/:id', authenticate, c.deletePost);
router.post('/posts/:id/vote', authenticate, c.votePost);
router.post('/posts/:id/comments', ...write, commentLimit, c.addComment);

// Comments
router.delete('/comments/:id', authenticate, c.deleteComment);
router.post('/comments/:id/vote', authenticate, c.voteComment);

// Media upload (photos/videos for a post)
router.post(
  '/media',
  ...write,
  mediaLimit,
  (req, res, next) => {
    communityMediaUpload.array('files', 10)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Each community media file must be under 20MB.' });
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Up to 4 media files per post.' });
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  c.uploadMedia,
);

// Search & profiles
router.get('/search', optionalAuth, searchLimit, c.search);
router.get('/users/:id', c.getUserProfile);

export default router;
