import streamifier from 'streamifier';
import prisma from '../config/prisma.js';
import cloudinary from '../config/cloudinary.js';

// Fields safe to send to the client — never the password hash.
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  organization: true,
  avatarUrl: true,
  createdAt: true,
  // Communities update — public contact links + privacy toggles
  bio: true,
  linkedinUrl: true,
  twitterUrl: true,
  researchGateUrl: true,
  orcidId: true,
  githubUrl: true,
  personalProfileUrl: true,
  mobileNumber: true,
  showEmail: true,
  showMobile: true,
};

const CONTACT_URL_FIELDS = ['linkedinUrl', 'twitterUrl', 'researchGateUrl', 'githubUrl', 'personalProfileUrl'];

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// GET /api/users/me — profile details + a quick summary of the user's
// contributions across the portal, for the Profile tab's stat strip.
export const getMe = async (req, res) => {
  try {
    const [user, expeditionsLedCount, contentUploadedCount, contentApprovedCount, activitiesCount] =
      await Promise.all([
        prisma.user.findUnique({ where: { id: req.user.id }, select: PUBLIC_USER_SELECT }),
        prisma.expedition.count({ where: { principalInvestigator: req.user.id } }),
        prisma.contentItem.count({ where: { uploadedBy: req.user.id } }),
        prisma.contentItem.count({ where: { approvedBy: req.user.id } }),
        prisma.activity.count({ where: { createdBy: req.user.id } }),
      ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      ...user,
      stats: {
        expeditionsLed: expeditionsLedCount,
        contentUploaded: contentUploadedCount,
        contentApproved: contentApprovedCount,
        activitiesCreated: activitiesCount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/users/me — self-service profile edit. Deliberately narrow:
// name / organization / avatarUrl only. Email, role, and password changes
// go through their own (more sensitive) flows, not this endpoint.
export const updateMe = async (req, res) => {
  const { name, organization, avatarUrl } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (organization !== undefined) data.organization = organization;
  if (avatarUrl !== undefined) data.avatarUrl = avatarUrl;

  // Contact links (Communities update). Empty string clears a link.
  for (const field of CONTACT_URL_FIELDS) {
    if (req.body[field] === undefined) continue;
    const value = typeof req.body[field] === 'string' ? req.body[field].trim().slice(0, 300) : '';
    if (value && !isHttpUrl(value)) {
      return res.status(400).json({ error: `${field} must be a full link starting with https://` });
    }
    data[field] = value || null;
  }
  if (req.body.orcidId !== undefined) {
    const orcid = String(req.body.orcidId || '').trim();
    if (orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcid)) {
      return res.status(400).json({ error: 'ORCID iD should look like 0000-0002-1825-0097' });
    }
    data.orcidId = orcid || null;
  }
  if (req.body.bio !== undefined) data.bio = String(req.body.bio || '').trim().slice(0, 500) || null;
  if (req.body.showEmail !== undefined) data.showEmail = Boolean(req.body.showEmail);
  if (req.body.showMobile !== undefined) data.showMobile = Boolean(req.body.showMobile);

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: PUBLIC_USER_SELECT,
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// POST /api/users/me/avatar — multipart/form-data, field name "avatar".
// Deliberately separate from the general /api/upload route: that one is
// restricted to researcher/comms_officer/admin because it's for content,
// but any authenticated user (including "public" role) should be able to
// set a picture on their own profile.
export const uploadAvatar = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided (expected multipart field "avatar")' });
  }

  try {
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: 'ncpor-portal/avatars',
      resource_type: 'image',
      eager: [{ width: 256, height: 256, crop: 'fill', gravity: 'face' }],
    });

    const avatarUrl = result.eager?.[0]?.secure_url || result.secure_url;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
      select: PUBLIC_USER_SELECT,
    });

    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: `Avatar upload failed: ${err.message}` });
  }
};
