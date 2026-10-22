import prisma from '../config/prisma.js';

// Shared field-mapping helper — pulls the scientific-metadata fields out of
// req.body and returns a Prisma-ready `data` object. Used by both create
// and update so the two can't drift out of sync on what a "metadata record"
// actually contains.
function mapMetadataFields(body, { partial = false } = {}) {
  const {
    title, description, expedition_id, principal_investigator, institution,
    region, station_id, exact_location, latitude, longitude,
    observation_start, observation_end,
    discipline, keywords, parameters, instrument_method, processing_level,
    access_conditions, citation, file_format, units,
  } = body;

  const keywordList = Array.isArray(keywords)
    ? keywords.map((k) => String(k).trim()).filter(Boolean)
    : typeof keywords === 'string'
      ? keywords.split(',').map((k) => k.trim()).filter(Boolean)
      : undefined;

  const parameterList = Array.isArray(parameters)
    ? parameters.map((p) => String(p).trim()).filter(Boolean)
    : typeof parameters === 'string'
      ? parameters.split(',').map((p) => p.trim()).filter(Boolean)
      : undefined;

  const data = {};
  if (title !== undefined) data.title = String(title).trim();
  if (description !== undefined) data.description = description || null;
  if (expedition_id !== undefined) data.expeditionId = expedition_id || null;
  if (principal_investigator !== undefined) data.principalInvestigator = principal_investigator || null;
  if (institution !== undefined) data.institution = institution || null;
  if (region !== undefined) data.region = region || null;
  if (station_id !== undefined) data.stationId = station_id || null;
  if (exact_location !== undefined) data.exactLocation = exact_location || null;
  if (latitude !== undefined) data.latitude = latitude === '' || latitude === null ? null : latitude;
  if (longitude !== undefined) data.longitude = longitude === '' || longitude === null ? null : longitude;
  if (observation_start !== undefined) data.observationStart = observation_start || null;
  if (observation_end !== undefined) data.observationEnd = observation_end || null;
  if (discipline !== undefined) data.discipline = discipline || null;
  if (keywordList !== undefined) data.keywords = keywordList;
  if (parameterList !== undefined) data.parameters = parameterList;
  if (instrument_method !== undefined) data.instrumentMethod = instrument_method || null;
  if (processing_level !== undefined) data.processingLevel = processing_level || null;
  if (access_conditions !== undefined) data.accessConditions = access_conditions || null;
  if (citation !== undefined) data.citation = citation || null;
  if (file_format !== undefined) data.fileFormat = file_format || null;
  if (units !== undefined) data.units = units || null;

  return data;
}

const VALID_ROLES = ['raw', 'processed', 'documentation', 'calibration', 'derived', 'other'];

function sanitizeMetadataRecord(record) {
  if (!record) return record;
  return {
    ...record,
    files: Array.isArray(record.files)
      ? record.files.map((file) => {
          if (!file?.content) return file;
          const { objectKey, wholeFileSha256, ...content } = file.content;
          return { ...file, content: { ...content, fileUrl: null } };
        })
      : record.files,
  };
}

function sanitizeMetadataRecords(records) {
  return Array.isArray(records) ? records.map(sanitizeMetadataRecord) : records;
}

function contentStorageError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// Phase 5: never trust a browser-supplied MinIO object key. A MinIO-backed
// DatasetFile may only be attached from a completed multipart session owned by
// the current user; all persisted storage facts come from that durable session.
async function resolveAttachedContent(content, userId) {
  if (!content) return content;

  // Final dataset storage policy: newly attached scientific dataset files
  // must come from a completed MinIO multipart session. Historical
  // Cloudinary-backed dataset rows remain readable; this only governs new
  // attachments created through this endpoint.
  const storageProvider = String(content.storage_provider || '').trim().toLowerCase();
  if (storageProvider && storageProvider !== 'minio') {
    throw contentStorageError(400, 'New scientific dataset files must be uploaded through MinIO.');
  }

  const sessionId = String(content.upload_session_id || '').trim();
  if (!sessionId) {
    throw contentStorageError(400, 'upload_session_id is required for a MinIO dataset file.');
  }

  const session = await prisma.datasetUploadSession.findUnique({ where: { id: sessionId } });
  if (!session) throw contentStorageError(404, 'Dataset upload session was not found.');
  if (session.userId !== userId) {
    throw contentStorageError(403, 'This dataset upload session belongs to another user.');
  }
  if (session.status !== 'completed') {
    throw contentStorageError(409, 'Dataset multipart upload is not completed yet.');
  }

  return {
    ...content,
    file_url: null,
    storage_provider: 'minio',
    object_key: session.objectKey,
    original_file_name: session.fileName,
    mime_type: session.mimeType,
    file_size_bytes: session.fileSize,
    checksum_sha256: session.checksumSha256 || null,
    whole_file_sha256: session.wholeFileSha256 || null,
    upload_status: 'completed',
  };
}

// files is a *list* now (one metadata record, many files) instead of a
// single `content` relation — this is the actual "one metadata = many
// files" change. Ordered oldest-first so a record's file history reads
// top-to-bottom the way it happened (raw first, processed later, etc.).
const INCLUDE_STANDARD = {
  expedition: { select: { id: true, name: true, region: true, shipName: true, voyageName: true } },
  station: { select: { id: true, name: true, region: true, latitude: true, longitude: true } },
  pi: { select: { id: true, name: true, organization: true } },
  creator: { select: { id: true, name: true, organization: true } },
  files: {
    orderBy: { createdAt: 'asc' },
    include: { content: true },
  },
  // Always included so a researcher immediately sees a reviewer's comment
  // (and the full back-and-forth) the moment they open their own record —
  // no separate fetch needed to find out why something was sent back.
  reviewHistory: {
    orderBy: { createdAt: 'asc' },
    include: { reviewer: { select: { id: true, name: true, role: true } } },
  },
};

// Builds one ContentItem's create data from a metadata record's own fields
// plus a content payload — shared by both places a file gets attached
// (create-with-file, and add-file-to-existing) so the two can't drift.
// Also carries the metadata record's Scientific Keywords (DatasetMetadata
// .keywords, already an array by the time this runs) onto the ContentItem
// as real Tag/ContentTag rows — the same mechanism content.controller.js's
// createContent uses — so a dataset's scientific keywords are searchable
// and filterable through the Archive the same way any other content's
// keywords are, without the researcher typing them in twice.
function buildContentItemData({ metadataLike, content, userId, isTrusted }) {
  const yearGuess = metadataLike.observationStart
    ? new Date(metadataLike.observationStart).getFullYear()
    : new Date().getFullYear();

  const keywordNames = Array.isArray(metadataLike.keywords)
    ? metadataLike.keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    expeditionId: metadataLike.expeditionId || null,
    type: 'dataset',
    title: metadataLike.title,
    description: metadataLike.description,
    fileUrl: content.file_url || null,
    storageProvider: content.storage_provider === 'minio' ? 'minio' : 'cloudinary',
    objectKey: content.storage_provider === 'minio' ? content.object_key : null,
    originalFileName: content.original_file_name || null,
    checksumSha256: content.checksum_sha256 || null,
    wholeFileSha256: content.whole_file_sha256 || null,
    uploadStatus: content.upload_status || 'completed',
    thumbnailUrl: content.thumbnail_url || null,
    mimeType: content.mime_type || null,
    fileSizeBytes: content.file_size_bytes || null,
    datasetMeta: content.dataset_meta || undefined,
    uploadedBy: userId,
    status: isTrusted ? 'published' : 'in_review',
    approvedBy: isTrusted ? userId : undefined,
    region: metadataLike.region || undefined,
    researchDomain: metadataLike.discipline || undefined,
    year: yearGuess,
    ...(keywordNames.length && {
      tags: {
        create: keywordNames.map((name) => ({
          tag: {
            connectOrCreate: {
              where: { name },
              create: { name, status: 'pending', suggestedBy: userId },
            },
          },
        })),
      },
    }),
  };
}

// POST /api/dataset-metadata
// Metadata-first create. Two shapes, both handled here:
//   1. Metadata only — no `content` block in the body. Creates a
//      DatasetMetadata row with zero DatasetFile rows (Priya submitting
//      her CTD description with no file yet).
//   2. Metadata + one file together — body includes a `content` block
//      ({ file_url, thumbnail_url, mime_type, file_size_bytes, dataset_meta })
//      and a `role` (raw/processed/documentation/calibration/derived/other,
//      defaults to 'raw'). Creates the DatasetMetadata row, its ContentItem,
//      and the DatasetFile row linking them, in one transaction — the
//      "both ready at once" case. Further files (a processed version added
//      later, a calibration PDF, etc.) go through addFileToMetadata below,
//      any number of times.
export const createDatasetMetadata = async (req, res) => {
  const { client_request_id, content, role } = req.body;

  try {
    if (client_request_id) {
      const existing = await prisma.datasetMetadata.findUnique({
        where: { clientRequestId: client_request_id },
        include: INCLUDE_STANDARD,
      });
      if (existing && existing.createdBy === req.user.id) {
        return res.status(200).json(sanitizeMetadataRecord(existing));
      }
    }

    if (!req.body.title || !String(req.body.title).trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (content && role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(', ')}` });
    }

    const resolvedContent = content ? await resolveAttachedContent(content, req.user.id) : null;

    const metadataData = mapMetadataFields(req.body);
    metadataData.principalInvestigator = metadataData.principalInvestigator || req.user.id;
    metadataData.createdBy = req.user.id;
    metadataData.clientRequestId = client_request_id || null;
    metadataData.status = 'submitted';
    metadataData.submittedAt = new Date();

    const isTrusted = ['admin', 'comms_officer'].includes(req.user.role);

    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.datasetMetadata.create({ data: metadataData });

      if (resolvedContent) {
        const contentItem = await tx.contentItem.create({
          data: buildContentItemData({ metadataLike: metadataData, content: resolvedContent, userId: req.user.id, isTrusted }),
        });
        await tx.datasetFile.create({
          data: {
            datasetMetadataId: created.id,
            contentItemId: contentItem.id,
            role: role || 'raw',
          },
        });
      }

      return tx.datasetMetadata.findUnique({ where: { id: created.id }, include: INCLUDE_STANDARD });
    });

    res.status(201).json(sanitizeMetadataRecord(record));
  } catch (err) {
    if (err.code === 'P2002' && client_request_id) {
      const existing = await prisma.datasetMetadata.findUnique({
        where: { clientRequestId: client_request_id },
        include: INCLUDE_STANDARD,
      });
      if (existing && existing.createdBy === req.user.id) {
        return res.status(200).json(sanitizeMetadataRecord(existing));
      }
    }
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// GET /api/dataset-metadata/mine?unlinked=true
// The researcher's own metadata records — this is the "Saved and Incomplete
// Metadata" list from the NPDC dashboard. unlinked=true narrows it to
// records with zero files attached at all (not "fewer than expected" — a
// record with one raw file and no processed file yet is not "unlinked", it
// can still receive more files, just isn't surfaced by this filtered view).
export const listMyDatasetMetadata = async (req, res) => {
  try {
    const { unlinked } = req.query;
    const where = { createdBy: req.user.id };
    if (unlinked === 'true') where.files = { none: {} };

    const records = await prisma.datasetMetadata.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: INCLUDE_STANDARD,
    });
    res.json(sanitizeMetadataRecords(records));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/dataset-metadata/queue — staff only. The Scientific Metadata
// tab in the Review Queue: everything currently waiting on ANY reviewer
// action — including Publish (approved) and Archive (published), not just
// the earlier review steps — across every researcher, not scoped to
// "mine" the way listMyDatasetMetadata above is. Only 'draft' (still the
// researcher's own private workspace) and the terminal 'archived' are
// excluded. ?status= can narrow to a specific subset.
const QUEUE_DEFAULT_STATUSES = ['submitted', 'under_review', 'changes_requested', 'approved', 'published'];
export const listMetadataQueue = async (req, res) => {
  try {
    const requested = req.query.status ? req.query.status.split(',').map((s) => s.trim()) : QUEUE_DEFAULT_STATUSES;
    const records = await prisma.datasetMetadata.findMany({
      where: { status: { in: requested } },
      orderBy: { updatedAt: 'asc' }, // oldest-waiting-first, same convention as the content review queue
      include: INCLUDE_STANDARD,
    });
    res.json(sanitizeMetadataRecords(records));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/dataset-metadata/:id
// Public callers only see 'published' records — same visibility rule as
// content.controller.js#getContentById. This is what lets a metadata record
// with no file yet still be discoverable once approved: nothing here checks
// whether any DatasetFile rows exist, only status.
export const getDatasetMetadataById = async (req, res) => {
  try {
    const record = await prisma.datasetMetadata.findUnique({
      where: { id: req.params.id },
      include: INCLUDE_STANDARD,
    });
    if (!record) return res.status(404).json({ error: 'Not found' });

    const isStaff = req.user && ['admin', 'comms_officer'].includes(req.user.role);
    const isOwner = req.user && req.user.id === record.createdBy;
    if (record.status !== 'published' && !isStaff && !isOwner) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(sanitizeMetadataRecord(record));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/dataset-metadata/:id
// Owner (while still draft/submitted) or staff can edit the descriptive
// fields. Once a record has moved past under_review a plain researcher can
// no longer quietly edit it out from under a reviewer — that needs staff.
export const updateDatasetMetadata = async (req, res) => {
  try {
    const existing = await prisma.datasetMetadata.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const isStaff = ['admin', 'comms_officer'].includes(req.user.role);
    const isOwner = req.user.id === existing.createdBy;
    if (!isStaff && !(isOwner && ['draft', 'submitted', 'changes_requested'].includes(existing.status))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const data = mapMetadataFields(req.body, { partial: true });
    const record = await prisma.datasetMetadata.update({
      where: { id: req.params.id },
      data,
      include: INCLUDE_STANDARD,
    });
    res.json(sanitizeMetadataRecord(record));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/dataset-metadata/:id/status — comms_officer/admin move a
// record through under_review -> approved -> published (or back to
// 'submitted' with a rejection, handled the same way the Review Queue
// already treats a rejected ContentItem).
// PATCH /api/dataset-metadata/:id/status — the scientific-metadata review
// workflow. Body: { action, comment? }. Every call here both moves the
// record's status AND writes one row to MetadataReviewHistory — the
// status field is always just "where it is now"; the history table is
// "how it got there", including every reviewer comment along the way.
const REVIEW_ACTIONS = {
  // action: { from: [allowed current statuses], to: new status, staffOnly, requireComment }
  start_review:     { from: ['submitted'],                       to: 'under_review',      staffOnly: true,  requireComment: false },
  request_changes:  { from: ['under_review'],                    to: 'changes_requested', staffOnly: true,  requireComment: true  },
  approve:          { from: ['under_review'],                    to: 'approved',          staffOnly: true,  requireComment: false },
  publish:          { from: ['approved'],                        to: 'published',         staffOnly: true,  requireComment: false },
  archive:          { from: ['published'],                       to: 'archived',          staffOnly: true,  requireComment: false },
  // Not a reviewer action — the researcher, after reading a
  // changes_requested comment and correcting the record via
  // updateDatasetMetadata above, sends it back into the queue themselves.
  resubmit:         { from: ['changes_requested'],                to: 'submitted',         staffOnly: false, requireComment: false },
};

export const updateDatasetMetadataStatus = async (req, res) => {
  const { action, comment } = req.body;
  const rule = REVIEW_ACTIONS[action];
  if (!rule) {
    return res.status(400).json({ error: `action must be one of: ${Object.keys(REVIEW_ACTIONS).join(', ')}` });
  }
  if (rule.requireComment && !comment?.trim()) {
    return res.status(400).json({ error: 'A comment is required to request changes.' });
  }

  try {
    const existing = await prisma.datasetMetadata.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const isStaff = ['admin', 'comms_officer'].includes(req.user.role);
    const isOwner = req.user.id === existing.createdBy;
    if (rule.staffOnly && !isStaff) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (!rule.staffOnly && !isStaff && !isOwner) {
      // resubmit — staff can also do this on a researcher's behalf, but a
      // stranger can't.
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (!rule.from.includes(existing.status)) {
      return res.status(409).json({
        error: `Can't ${action.replace('_', ' ')} from status "${existing.status}" — expected one of: ${rule.from.join(', ')}.`,
      });
    }

    const record = await prisma.$transaction(async (tx) => {
      const updated = await tx.datasetMetadata.update({
        where: { id: req.params.id },
        data: { status: rule.to },
        include: INCLUDE_STANDARD,
      });
      await tx.metadataReviewHistory.create({
        data: {
          metadataId: req.params.id,
          // A resubmit is the researcher's own action, not a review
          // decision — recorded with no reviewerId so the history reads
          // correctly as "no one reviewed this yet" rather than
          // attributing it to whoever happened to click the button.
          reviewerId: action === 'resubmit' ? null : req.user.id,
          action,
          comment: comment?.trim() || null,
          oldStatus: existing.status,
          newStatus: rule.to,
        },
      });
      return updated;
    });

    res.json(sanitizeMetadataRecord(record));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};

// GET /api/dataset-metadata/:id/review-history — standalone endpoint for
// when a caller wants just the history without refetching the whole
// record (INCLUDE_STANDARD already attaches it to every normal fetch).
export const getMetadataReviewHistory = async (req, res) => {
  try {
    const history = await prisma.metadataReviewHistory.findMany({
      where: { metadataId: req.params.id },
      orderBy: { createdAt: 'asc' },
      include: { reviewer: { select: { id: true, name: true, role: true } } },
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/dataset-metadata/:id/files
// Adds one more file to an existing metadata record — the actual "one
// metadata, many files" operation. Unlike the old single-slot /attach
// endpoint, this can be called repeatedly against the same record: a 'raw'
// file today, a 'processed' file next week, a 'calibration' PDF after
// that. Each call creates one new ContentItem + one new DatasetFile row;
// records that already have files are never blocked from getting more.
// Body: { role, label?, file_url, thumbnail_url, mime_type, file_size_bytes, dataset_meta }
export const addFileToMetadata = async (req, res) => {
  try {
    const existing = await prisma.datasetMetadata.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const isStaff = ['admin', 'comms_officer'].includes(req.user.role);
    const isOwner = req.user.id === existing.createdBy;
    if (!isStaff && !isOwner) return res.status(403).json({ error: 'Insufficient permissions' });

    const { role, label, ...contentInput } = req.body;
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(', ')}` });
    }

    const resolvedContent = await resolveAttachedContent(contentInput, req.user.id);

    // Phase 15 regression guard: final metadata attachment must be retry-safe.
    // If this exact completed MinIO object was already linked to this metadata
    // record but the previous HTTP response was lost, return the durable
    // record instead of attempting to create a second ContentItem with the
    // same unique objectKey. Never silently attach one MinIO object to two
    // different metadata records.
    if (resolvedContent?.object_key) {
      const alreadyStored = await prisma.contentItem.findUnique({
        where: { objectKey: resolvedContent.object_key },
        include: { datasetFileLink: { select: { datasetMetadataId: true } } },
      });

      if (alreadyStored) {
        if (alreadyStored.datasetFileLink?.datasetMetadataId === existing.id) {
          const current = await prisma.datasetMetadata.findUnique({
            where: { id: existing.id },
            include: INCLUDE_STANDARD,
          });
          return res.json(sanitizeMetadataRecord(current));
        }
        return res.status(409).json({
          error: 'This completed dataset upload is already attached to another dataset record.',
        });
      }
    }

    const record = await prisma.$transaction(async (tx) => {
      const contentItem = await tx.contentItem.create({
        data: buildContentItemData({
          metadataLike: existing,
          content: resolvedContent,
          userId: req.user.id,
          isTrusted: isStaff,
        }),
      });
      await tx.datasetFile.create({
        data: {
          datasetMetadataId: existing.id,
          contentItemId: contentItem.id,
          role: role || 'raw',
          label: label || null,
        },
      });
      return tx.datasetMetadata.findUnique({ where: { id: existing.id }, include: INCLUDE_STANDARD });
    });

    res.json(sanitizeMetadataRecord(record));
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/dataset-metadata/:id/files/:fileId
// Removes one file from a metadata record without touching the record or
// its other files — the other direction of "many files per record": adding
// one shouldn't be the only thing possible. Deletes both the join row and
// the underlying ContentItem (the schema's cascade only runs the other
// way — deleting a ContentItem takes its DatasetFile row with it, not the
// reverse — so both are removed explicitly here, in that order). Owner or
// staff only.
export const removeFileFromMetadata = async (req, res) => {
  try {
    const file = await prisma.datasetFile.findUnique({ where: { id: req.params.fileId } });
    if (!file || file.datasetMetadataId !== req.params.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const metadata = await prisma.datasetMetadata.findUnique({
      where: { id: req.params.id },
      select: { createdBy: true },
    });
    const isStaff = ['admin', 'comms_officer'].includes(req.user.role);
    const isOwner = req.user.id === metadata?.createdBy;
    if (!isStaff && !isOwner) return res.status(403).json({ error: 'Insufficient permissions' });

    await prisma.$transaction([
      prisma.datasetFile.delete({ where: { id: file.id } }),
      prisma.contentItem.delete({ where: { id: file.contentItemId } }),
    ]);
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};
