import streamifier from 'streamifier';
import cloudinary from '../config/cloudinary.js';

// Which NCPOR content type maps to which Cloudinary resource_type.
// Images/videos get Cloudinary's native handling (thumbnails, transforms).
// Everything else (PDFs, datasets, docs) goes in as 'raw'.
function resolveResourceType(mimeType) {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  return 'raw';
}

function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// POST /api/upload — single file upload (field name: "file")
// Returns file_url + thumbnail_url + metadata, ready to pass into POST /api/content
export const uploadFile = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided (expected multipart field "file")' });
  }

  const resourceType = resolveResourceType(req.file.mimetype);

  try {
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: 'ncpor-portal',
      resource_type: resourceType,
      // For images, ask Cloudinary to also generate a small eager thumbnail
      eager: resourceType === 'image' ? [{ width: 400, height: 400, crop: 'fill' }] : undefined,
    });

    res.status(201).json({
      file_url: result.secure_url,
      thumbnail_url: result.eager?.[0]?.secure_url || (resourceType === 'video' ? result.secure_url.replace(/\.\w+$/, '.jpg') : null),
      mime_type: req.file.mimetype,
      file_size_bytes: req.file.size,
      cloudinary_public_id: result.public_id,
      resource_type: resourceType,
    });
  } catch (err) {
    res.status(500).json({ error: `Upload failed: ${err.message}` });
  }
};
