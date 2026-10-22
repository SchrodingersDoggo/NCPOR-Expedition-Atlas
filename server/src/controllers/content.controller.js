import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import prisma from '../config/prisma.js';
import { createPresignedDownloadUrl, headObject } from '../services/minio.service.js';



function sanitizeDatasetStorageFields(item) {
  if (!item || item.type !== 'dataset') return item;
  const { objectKey, wholeFileSha256, ...rest } = item;
  return { ...rest, fileUrl: null };
}

async function getDatasetFileAccess(item, user) {
  const isStaff = Boolean(user && ['admin', 'comms_officer'].includes(user.role));
  const isOwner = Boolean(user && user.id === item.uploadedBy);

  if (item.type !== 'dataset' || isStaff || isOwner || item.accessLevel === 'open') {
    return { granted: true, accessState: 'granted' };
  }

  if (item.accessLevel === 'registered') {
    return user
      ? { granted: true, accessState: 'granted' }
      : { granted: false, accessState: 'login_required' };
  }

  if (['request_required', 'restricted'].includes(item.accessLevel)) {
    if (!user) return { granted: false, accessState: 'request_required' };
    const request = await prisma.datasetAccessRequest.findUnique({
      where: { userId_contentItemId: { userId: user.id, contentItemId: item.id } },
    });
    return request?.status === 'approved'
      ? { granted: true, accessState: 'granted' }
      : { granted: false, accessState: request?.status || 'request_required' };
  }

  return { granted: false, accessState: 'request_required' };
}

function datasetStorageError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function opaqueFingerprint(parts) {
  return createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex');
}

function normalizeEtag(value) {
  return String(value || '').replace(/^"|"$/g, '').trim() || null;
}

async function prepareDatasetAccessPayload(item) {
  const fileName = item.originalFileName || item.title || 'dataset';

  if (item.storageProvider === 'minio') {
    if (item.uploadStatus !== 'completed' || !item.objectKey) {
      throw datasetStorageError(409, 'Dataset file is not available for download yet.');
    }

    // HEAD is intentionally server-side: it validates the current object
    // version/size without revealing the private MinIO object key to the
    // browser. Legacy visualizer fingerprints depend on this version data.
    const object = await headObject({ objectKey: item.objectKey });
    const signed = await createPresignedDownloadUrl({
      objectKey: item.objectKey,
      fileName,
    });

    const fileSize = Number(object.contentLength ?? item.fileSizeBytes ?? 0) || null;
    const etag = normalizeEtag(object.etag);
    const wholeFileSha256 = String(item.wholeFileSha256 || '').trim().toLowerCase() || null;
    const datasetFingerprint = wholeFileSha256
      ? `sha256:${wholeFileSha256}`
      : `legacy:${opaqueFingerprint([
          item.id,
          object.versionId || '',
          etag || '',
          fileSize || '',
        ])}`;

    return {
      url: signed.url,
      expiresIn: signed.expiresIn,
      expiresAt: new Date(Date.now() + signed.expiresIn * 1000).toISOString(),
      storageProvider: 'minio',
      fileName,
      fileSize,
      mimeType: object.contentType || item.mimeType || 'application/octet-stream',
      // Only the true whole-file digest is exposed under checksumSha256.
      // The older field may be a multipart/composite storage checksum.
      checksumSha256: wholeFileSha256,
      storageChecksumSha256: object.checksumSHA256 || item.checksumSha256 || null,
      etag,
      datasetFingerprint,
      fingerprintSource: wholeFileSha256 ? 'whole-file-sha256' : 'legacy-minio-version',
      datasetMeta: item.datasetMeta || null,
    };
  }

  if (item.storageProvider === 'cloudinary') {
    if (!item.fileUrl) throw datasetStorageError(404, 'Dataset file was not found.');
    const fileSize = Number(item.fileSizeBytes ?? 0) || null;
    const wholeFileSha256 = String(item.wholeFileSha256 || '').trim().toLowerCase() || null;
    return {
      url: item.fileUrl,
      expiresIn: null,
      expiresAt: null,
      storageProvider: 'cloudinary',
      fileName,
      fileSize,
      mimeType: item.mimeType || 'application/octet-stream',
      checksumSha256: wholeFileSha256,
      storageChecksumSha256: item.checksumSha256 || null,
      etag: null,
      datasetFingerprint: wholeFileSha256
        ? `sha256:${wholeFileSha256}`
        : `legacy-cloudinary:${opaqueFingerprint([
            item.id,
            item.updatedAt?.toISOString?.() || item.updatedAt || '',
            fileSize || '',
            item.fileUrl,
          ])}`,
      fingerprintSource: wholeFileSha256 ? 'whole-file-sha256' : 'legacy-cloudinary-version',
      datasetMeta: item.datasetMeta || null,
    };
  }

  throw datasetStorageError(409, 'Dataset storage provider is not supported.');
}

async function loadAuthorizedDatasetItem(req, { action = 'access' } = {}) {
  const item = await prisma.contentItem.findUnique({ where: { id: req.params.id } });
  if (!item) throw datasetStorageError(404, 'Not found');

  const isStaff = req.user && ['admin', 'comms_officer'].includes(req.user.role);
  const isOwner = req.user && req.user.id === item.uploadedBy;
  if (item.status !== 'published' && !isStaff && !isOwner) {
    throw datasetStorageError(404, 'Not found');
  }
  if (item.type !== 'dataset') {
    throw datasetStorageError(
      400,
      action === 'download'
        ? 'Secure dataset download is only available for dataset content.'
        : 'Secure dataset access is only available for dataset content.'
    );
  }

  const access = await getDatasetFileAccess(item, req.user);
  if (!access.granted) {
    const status = access.accessState === 'login_required' ? 401 : 403;
    const error = datasetStorageError(
      status,
      access.accessState === 'login_required'
        ? (action === 'download' ? 'Sign in to download this dataset.' : 'Sign in to access this dataset.')
        : (action === 'download'
            ? 'You do not currently have access to download this dataset.'
            : 'You do not currently have access to this dataset.')
    );
    error.accessState = access.accessState;
    throw error;
  }

  return item;
}

// Offline-queued dataset content still uses the long-standing /content
// metadata endpoint, but its bytes must now come from MinIO. Never trust a
// browser-supplied object key/URL: resolve the completed upload session owned
// by the authenticated user and derive every storage field from PostgreSQL.
async function resolveNewDatasetStorage({ type, fileUrl, storageProvider, uploadSessionId }, userId) {
  if (type !== 'dataset') return null;

  const provider = String(storageProvider || '').trim().toLowerCase();
  const sessionId = String(uploadSessionId || '').trim();
  const hasFileReference = Boolean(fileUrl || sessionId || provider);
  if (!hasFileReference) return null;

  if (provider && provider !== 'minio') {
    throw datasetStorageError(400, 'New scientific dataset files must be uploaded through MinIO.');
  }
  if (fileUrl) {
    throw datasetStorageError(400, 'New scientific dataset files cannot use a Cloudinary file URL.');
  }
  if (!sessionId) {
    throw datasetStorageError(400, 'upload_session_id is required for a scientific dataset file.');
  }

  const session = await prisma.datasetUploadSession.findUnique({ where: { id: sessionId } });
  if (!session) throw datasetStorageError(404, 'Dataset upload session was not found.');
  if (session.userId !== userId) {
    throw datasetStorageError(403, 'This dataset upload session belongs to another user.');
  }
  if (session.status !== 'completed') {
    throw datasetStorageError(409, 'Dataset multipart upload is not completed yet.');
  }

  return {
    fileUrl: null,
    storageProvider: 'minio',
    objectKey: session.objectKey,
    originalFileName: session.fileName,
    checksumSha256: session.checksumSha256 || null,
    wholeFileSha256: session.wholeFileSha256 || null,
    uploadStatus: 'completed',
    mimeType: session.mimeType,
    fileSizeBytes: session.fileSize,
  };
}

// GET /api/content?type=report&status=published&search=glacier&expedition_id=...
export const listContent = async (req, res) => {
  const { type, status, search, expedition_id } = req.query;

  try {
    // Full-text search still needs raw SQL (Prisma has no tsvector support)
        if (search) {
      const typeFilter = type ? Prisma.sql`AND type = ${type}::"ContentType"` : Prisma.empty;
      const rows = await prisma.$queryRaw`
        SELECT id, expedition_id, type, title, description, file_url, thumbnail_url,
               file_size_bytes, mime_type, status, uploaded_by, approved_by,
               view_count, download_count, created_at, updated_at, datasetMeta
        FROM content_items
        WHERE search_vector @@ plainto_tsquery('english', ${search})
          AND status = ${status || 'published'}::"ContentStatus"
          ${typeFilter}
        ORDER BY created_at DESC
      `;
      return res.json(rows.map((row) => (
        row.type === 'dataset' ? { ...row, file_url: null } : row
      )));
    }

    const items = await prisma.contentItem.findMany({
      where: {
        status: status || 'published',
        ...(type && { type }),
        ...(expedition_id && { expeditionId: expedition_id }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        expedition: true,
        uploader: { select: { id: true, name: true, email: true, organization: true } },
        approver: { select: { id: true, name: true, organization: true } },
        tags: { include: { tag: true } },
        // Metadata-first dataset fields (NPDC parity) — this file's role
        // (raw/processed/documentation/calibration/derived/other) within
        // its DatasetMetadata record. Null for every non-dataset type and
        // for datasets with no linked metadata record.
        datasetFileLink: { select: { role: true, label: true } },
      },
    });
    res.json(items.map((item) => {
      const { datasetFileLink, ...rest } = item;
      const safe = sanitizeDatasetStorageFields(rest);
      return { ...safe, fileRole: datasetFileLink?.role || null, fileRoleLabel: datasetFileLink?.label || null };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/content — create new content item.
// admin / comms_officer uploads are trusted and go straight to 'published'
// (self-approved). Everyone else (researchers) lands in 'in_review' so it's
// visibly queued for a comms_officer/admin to publish, instead of silently
// sitting as an untouched 'draft' forever.
export const createContent = async (req, res) => {
  const {
    expedition_id,
    type,
    title,
    description,
    body,
    summary,
    file_url,
    thumbnail_url,
    mime_type,
    file_size_bytes,
    datasetMeta,
    client_request_id,
    storage_provider,
    upload_session_id,
    // Archive module (Phase 6) metadata — all optional so this stays
    // backwards compatible with every existing caller (UploadPage etc.)
    // that doesn't send any of these.
    region,
    research_domain,
    authors,
    source,
    year,
    keywords,
  } = req.body;
  try {
    // Phase 4: a retry after a lost response must return the original item,
    // not create a second ContentItem. Scope the lookup to its owner.
    if (client_request_id) {
      const existing = await prisma.contentItem.findUnique({
        where: { clientRequestId: client_request_id },
      });
      if (existing && existing.uploadedBy === req.user.id) {
        return res.status(200).json(existing);
      }
    }

    const datasetStorage = await resolveNewDatasetStorage(
      {
        type,
        fileUrl: file_url,
        storageProvider: storage_provider,
        uploadSessionId: upload_session_id,
      },
      req.user.id
    );

    const isTrusted = ['admin', 'comms_officer'].includes(req.user.role);

    // Archive year defaults to the linked expedition's start year (so old
    // material archived against a past expedition lands on the right point
    // of the Year Timeline without the uploader typing it in), then falls
    // back to the current year.
    let archiveYear = year ? parseInt(year, 10) : undefined;
    if (!archiveYear && expedition_id) {
      const expedition = await prisma.expedition.findUnique({
        where: { id: expedition_id },
        select: { startDate: true, region: true },
      });
      if (expedition?.startDate) archiveYear = new Date(expedition.startDate).getFullYear();
      if (!region && expedition?.region) req.body.region = expedition.region; // fall through to below
    }
    if (!archiveYear) archiveYear = new Date().getFullYear();

    const keywordNames = Array.isArray(keywords)
      ? keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
      : typeof keywords === 'string'
        ? keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
        : [];

    const item = await prisma.contentItem.create({
      data: {
        expeditionId: expedition_id,
        type,
        title,
        description,
        body,
        summary,
        fileUrl: datasetStorage ? datasetStorage.fileUrl : file_url,
        ...(datasetStorage && {
          storageProvider: datasetStorage.storageProvider,
          objectKey: datasetStorage.objectKey,
          originalFileName: datasetStorage.originalFileName,
          checksumSha256: datasetStorage.checksumSha256,
          wholeFileSha256: datasetStorage.wholeFileSha256,
          uploadStatus: datasetStorage.uploadStatus,
        }),
        thumbnailUrl: thumbnail_url,
        mimeType: datasetStorage?.mimeType || mime_type,
        fileSizeBytes: datasetStorage?.fileSizeBytes || file_size_bytes,
        datasetMeta: datasetMeta || undefined,
        clientRequestId: client_request_id || null,
        uploadedBy: req.user.id,
        status: isTrusted ? 'published' : 'in_review',
        approvedBy: isTrusted ? req.user.id : undefined,
        region: region || req.body.region || undefined,
        researchDomain: research_domain || undefined,
        authors: authors || undefined,
        source: source || undefined,
        year: archiveYear,
        // Controlled Scientific Keywords vocabulary: connecting to an
        // existing tag (any status) just attaches it, but a genuinely new
        // term is created as 'pending' — a suggestion, not an immediately
        // usable keyword — until a comms_officer/admin approves it via
        // PATCH /api/keywords/:id/status. Approved ones are unaffected;
        // this only changes what happens on first use of a brand-new word.
        ...(keywordNames.length && {
          tags: {
            create: keywordNames.map((name) => ({
              tag: {
                connectOrCreate: {
                  where: { name },
                  create: { name, status: 'pending', suggestedBy: req.user.id },
                },
              },
            })),
          },
        }),
      },
      include: { expedition: true, tags: { include: { tag: true } } },
    });
    res.status(201).json(item);
  } catch (err) {
    if (err.code === 'P2002' && client_request_id) {
      const existing = await prisma.contentItem.findUnique({
        where: { clientRequestId: client_request_id },
      });
      if (existing && existing.uploadedBy === req.user.id) {
        return res.status(200).json(existing);
      }
    }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/content/:id/status — move through draft -> in_review -> published
export const updateContentStatus = async (req, res) => {
  const { status } = req.body; // 'in_review' | 'published' | 'archived'
  try {
    const item = await prisma.contentItem.update({
      where: { id: req.params.id },
      data: { status, approvedBy: req.user.id },
    });
    res.json(item);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};


// PATCH /api/content/:id — comms_officer/admin can edit the full archive
// metadata and written content attached to an expedition. File replacement
// remains handled by the upload flow; this endpoint edits the record itself.
export const updateContent = async (req, res) => {
  try {
    const existing = await prisma.contentItem.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const {
      type, title, description, body, summary, region, research_domain,
      authors, source, year, keywords, thumbnail_url,
    } = req.body;

    if (title !== undefined && !String(title).trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const keywordNames = Array.isArray(keywords)
      ? keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
      : typeof keywords === 'string'
        ? keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
        : null;

    const data = {};
    if (type !== undefined) data.type = type;
    if (title !== undefined) data.title = String(title).trim();
    if (description !== undefined) data.description = description ? String(description).trim() : null;
    if (body !== undefined) data.body = body || null;
    if (summary !== undefined) data.summary = summary ? String(summary).trim() : null;
    if (region !== undefined) data.region = region || null;
    if (research_domain !== undefined) data.researchDomain = research_domain || null;
    if (authors !== undefined) data.authors = authors ? String(authors).trim() : null;
    if (source !== undefined) data.source = source ? String(source).trim() : null;
    if (thumbnail_url !== undefined) data.thumbnailUrl = thumbnail_url || null;
    if (year !== undefined) {
      if (year === '' || year === null) data.year = null;
      else {
        const parsedYear = Number.parseInt(year, 10);
        if (!Number.isInteger(parsedYear) || parsedYear < 1800 || parsedYear > 2200) {
          return res.status(400).json({ error: 'Archive year is invalid' });
        }
        data.year = parsedYear;
      }
    }
    if (keywordNames !== null) {
      data.tags = {
        deleteMany: {},
        ...(keywordNames.length ? {
          create: keywordNames.map((name) => ({
            tag: {
              connectOrCreate: {
                where: { name },
                create: { name, status: 'pending', suggestedBy: req.user.id },
              },
            },
          })),
        } : {}),
      };
    }

    const item = await prisma.contentItem.update({
      where: { id: req.params.id },
      data,
      include: {
        expedition: true,
        uploader: { select: { id: true, name: true, organization: true } },
        approver: { select: { id: true, name: true, organization: true } },
        tags: { include: { tag: true } },
      },
    });
    res.json(item);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};

// GET /api/content/:id/download — resolve a dataset file only after the
// existing dataset-access rules pass. MinIO objects receive a short-lived
// presigned URL; historical Cloudinary-backed datasets keep their existing
// URL and are not migrated.
export const getContentDownload = async (req, res) => {
  try {
    const item = await loadAuthorizedDatasetItem(req, { action: 'download' });
    const result = await prepareDatasetAccessPayload(item);

    try {
      await prisma.contentItem.update({
        where: { id: item.id },
        data: { downloadCount: { increment: 1 } },
      });
    } catch (countError) {
      console.warn('Could not increment dataset download count:', countError.message);
    }

    return res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        ...(err.accessState ? { accessState: err.accessState } : {}),
      });
    }
    console.error('Dataset download URL error:', err);
    res.status(500).json({ error: 'Could not prepare this dataset download.' });
  }
};

// GET /api/content/:id/access — visualizer/download metadata without
// incrementing downloadCount. Uses the exact same authorization path as the
// download endpoint and never returns MinIO object keys or credentials.
export const getContentAccess = async (req, res) => {
  try {
    const item = await loadAuthorizedDatasetItem(req);
    const result = await prepareDatasetAccessPayload(item);
    return res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        ...(err.accessState ? { accessState: err.accessState } : {}),
      });
    }
    console.error('Dataset access metadata error:', err);
    return res.status(500).json({ error: 'Could not prepare dataset access.' });
  }
};

// GET /api/content/:id
// Public callers only ever see published items. Uploaders, comms_officers,
// and admins can also view their own / any non-published item (drafts,
// in_review, archived) — everyone else gets a 404 (not 403, so we don't
// confirm the id exists at all).
export const getContentById = async (req, res) => {
  try {
    const item = await prisma.contentItem.findUnique({
      where: { id: req.params.id },
      include: {
        expedition: true,
        tags: { include: { tag: true } },
        aiGenerations: true,
        datasetFileLink: { select: { role: true, label: true } },
      },
    });
    if (!item) return res.status(404).json({ error: 'Not found' });

    const isStaff = req.user && ['admin', 'comms_officer'].includes(req.user.role);
    const isOwner = req.user && req.user.id === item.uploadedBy;

    if (item.status !== 'published' && !isStaff && !isOwner) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Only bump the view count for items that are actually publicly visible,
    // so drafts/in_review being previewed by staff don't rack up fake views.
    if (item.status === 'published') {
      const updated = await prisma.contentItem.update({
        where: { id: req.params.id },
        data: { viewCount: { increment: 1 } },
      });
      item.viewCount = updated.viewCount;
    }

    const { datasetFileLink, ...rest } = item;
    const access = await getDatasetFileAccess(item, req.user);
    const safe = sanitizeDatasetStorageFields(rest);

    res.json({
      ...safe,
      accessState: access.accessState,
      downloadAvailable: item.type === 'dataset'
        ? access.granted && Boolean(item.objectKey || item.fileUrl)
        : Boolean(item.fileUrl),
      fileRole: datasetFileLink?.role || null,
      fileRoleLabel: datasetFileLink?.label || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
