import multer from 'multer';

const ALLOWED_MIME_TYPES = [
  // documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/tab-separated-values',
  'text/plain',
  'application/json',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  // video
  'video/mp4',
  'video/quicktime',
  'video/webm',
];

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB — expedition videos/datasets can be large

const storage = multer.memoryStorage(); // buffer stays in memory, then streamed straight to Cloudinary

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type "${file.mimetype}" is not allowed`));
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// Separate, stricter config for profile avatars — images only, much
// smaller cap, since these never need to hold datasets/videos/PDFs.
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const avatarUpload = multer({
  storage,
  fileFilter(req, file, cb) {
    if (AVATAR_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Avatar must be an image (got "${file.mimetype}")`));
    }
  },
  limits: { fileSize: MAX_AVATAR_SIZE_BYTES },
});

// Communities — photos & videos attached to a post. Separate config so the
// general content upload limits above stay exactly as they were.
const COMMUNITY_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];

export const communityMediaUpload = multer({
  storage,
  fileFilter(req, file, cb) {
    if (COMMUNITY_MEDIA_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`"${file.mimetype}" is not supported. Use JPG, PNG, WEBP, GIF, MP4, WEBM or MOV.`));
  },
  // Keep the worst-case in-memory request bounded on small Render instances.
  // This only affects Communities; expedition/content upload limits are unchanged.
  limits: { fileSize: 20 * 1024 * 1024, files: 4 },
});
