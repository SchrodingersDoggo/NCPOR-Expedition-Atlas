import path from 'path';
import { randomUUID } from 'crypto';
import prisma from '../config/prisma.js';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  createPresignedPartUrl,
  headObject,
  listUploadedParts,
} from '../services/minio.service.js';
import {
  createDatasetUploadSession,
  verifyDatasetUploadSession,
} from '../utils/datasetUploadSession.js';

const MIB = 1024 * 1024;
const MIN_MULTIPART_PART_SIZE = 5 * MIB;
const MAX_MULTIPART_PARTS = 10_000;
const MAX_FILE_NAME_LENGTH = 255;
const CHECKSUM_ALGORITHM_SHA256 = 'SHA256';
const SHA256_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const STALE_UPLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Keep this in sync with the Phase 0 dataset picker. This allow-list applies
// only to the dedicated scientific-dataset multipart API; normal /api/upload
// keeps its existing Cloudinary rules untouched.
const DATASET_EXTENSIONS = new Set([
  '.csv', '.tsv', '.xls', '.xlsx', '.json', '.cnv',
  '.nc', '.nc4', '.h5', '.hdf5', '.grib', '.grb', '.zip',
]);

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getSessionToken(req) {
  return (
    req.get('x-dataset-upload-session') ||
    req.body?.sessionToken ||
    ''
  );
}

function toRuntimeSession(record) {
  const fileSize = Number(record.fileSize);
  const partSize = Number(record.partSize);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || !Number.isSafeInteger(partSize) || partSize <= 0) {
    throw httpError(500, 'Stored dataset upload session is invalid.');
  }
  return { ...record, fileSize, partSize };
}

async function getPersistedSession(req) {
  const claims = verifyDatasetUploadSession(getSessionToken(req), req.user.id);
  const record = await prisma.datasetUploadSession.findUnique({
    where: { id: claims.sessionId },
  });

  if (!record) {
    throw httpError(404, 'Dataset upload session was not found.');
  }
  if (record.userId !== req.user.id) {
    throw httpError(403, 'This dataset upload session belongs to another user.');
  }

  return toRuntimeSession(record);
}

function assertSessionCanUpload(session) {
  if (session.status === 'completed') {
    throw httpError(409, 'Dataset upload has already been completed.');
  }
  if (session.status === 'aborted') {
    throw httpError(409, 'Dataset upload has already been aborted.');
  }
  if (session.status === 'failed') {
    throw httpError(409, 'Dataset upload is marked as failed.');
  }
}

function sanitizeFileName(input) {
  const raw = String(input || '').trim();
  if (!raw) throw httpError(400, 'fileName is required.');

  // basename protects object-key generation from path traversal supplied by a
  // browser/client. Also normalize Windows separators before path.basename.
  const baseName = path.posix.basename(raw.replace(/\\/g, '/')).trim();
  if (!baseName || baseName === '.' || baseName === '..') {
    throw httpError(400, 'Invalid dataset file name.');
  }
  if (baseName.length > MAX_FILE_NAME_LENGTH) {
    throw httpError(400, `Dataset file name must be ${MAX_FILE_NAME_LENGTH} characters or fewer.`);
  }
  if (/\0|[\r\n]/.test(baseName)) {
    throw httpError(400, 'Invalid characters in dataset file name.');
  }

  const extension = path.extname(baseName).toLowerCase();
  if (!DATASET_EXTENSIONS.has(extension)) {
    throw httpError(
      400,
      `Unsupported dataset type "${extension || 'none'}". Allowed: ${[...DATASET_EXTENSIONS].join(', ')}.`
    );
  }

  return baseName;
}

function normalizeFileSize(value) {
  const fileSize = Number(value);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw httpError(400, 'fileSize must be a positive integer number of bytes.');
  }
  return fileSize;
}

function normalizeMimeType(value) {
  const mimeType = String(value || 'application/octet-stream').trim();
  if (mimeType.length > 255 || /[\r\n]/.test(mimeType)) {
    throw httpError(400, 'Invalid mimeType.');
  }
  return mimeType || 'application/octet-stream';
}

function choosePartSize(fileSize) {
  // 5 MiB is the normal Phase 5 chunk size. If a future file is so large that
  // 5 MiB would exceed S3's 10,000-part limit, grow to the next whole MiB.
  const minimumToFit = Math.ceil(fileSize / MAX_MULTIPART_PARTS);
  return Math.max(MIN_MULTIPART_PART_SIZE, Math.ceil(minimumToFit / MIB) * MIB);
}

function makeObjectKey(userId, fileName) {
  const safeStem = fileName
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-120) || 'dataset';
  const day = new Date().toISOString().slice(0, 10);
  return `datasets/${userId}/${day}/${randomUUID()}-${safeStem}`;
}

function assertPartNumber(value) {
  const partNumber = Number(value);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_MULTIPART_PARTS) {
    throw httpError(400, `partNumber must be an integer between 1 and ${MAX_MULTIPART_PARTS}.`);
  }
  return partNumber;
}

function normalizeSha256ChecksumBase64(value, { statusCode = 400, fieldName = 'checksumSHA256' } = {}) {
  const checksum = String(value || '').trim();
  if (!SHA256_BASE64_PATTERN.test(checksum)) {
    throw httpError(statusCode, `${fieldName} must be a Base64-encoded SHA-256 digest.`);
  }
  return checksum;
}

function normalizeWholeFileSha256(value, { optional = false } = {}) {
  const checksum = String(value || '').trim().toLowerCase();
  if (!checksum && optional) return null;
  if (!SHA256_HEX_PATTERN.test(checksum)) {
    throw httpError(400, 'wholeFileSha256 must be a 64-character hexadecimal SHA-256 digest.');
  }
  return checksum;
}

function verifyUploadedChecksums(parts, checksumAlgorithm) {
  if (checksumAlgorithm !== CHECKSUM_ALGORITHM_SHA256) return;

  for (const part of parts) {
    normalizeSha256ChecksumBase64(part.checksumSHA256, {
      statusCode: 409,
      fieldName: `Checksum for part ${part.partNumber}`,
    });
  }
}

function verifyUploadedByteCount(parts, expectedSize, expectedPartSize) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw httpError(409, 'No uploaded parts were found for this dataset.');
  }

  const expectedPartCount = Math.ceil(expectedSize / expectedPartSize);
  const finalPartSize = expectedSize - (expectedPartSize * (expectedPartCount - 1));
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);

  if (sorted.length !== expectedPartCount) {
    throw httpError(
      409,
      `Multipart upload is incomplete. Expected ${expectedPartCount} parts but found ${sorted.length}.`
    );
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const part = sorted[index];
    const expectedPartNumber = index + 1;
    if (part.partNumber !== expectedPartNumber) {
      throw httpError(409, `Multipart upload is incomplete. Missing part ${expectedPartNumber}.`);
    }

    const expectedBytes = expectedPartNumber === expectedPartCount
      ? finalPartSize
      : expectedPartSize;
    const actualBytes = Number(part.size);
    if (!Number.isSafeInteger(actualBytes) || actualBytes !== expectedBytes) {
      throw httpError(
        409,
        `Part ${part.partNumber} has an unexpected size (${actualBytes} bytes; expected ${expectedBytes} bytes).`
      );
    }
  }

  const uploadedBytes = sorted.reduce((sum, part) => sum + Number(part.size), 0);
  if (!Number.isSafeInteger(uploadedBytes) || uploadedBytes !== expectedSize) {
    throw httpError(
      409,
      `Uploaded byte count does not match the original file size (${uploadedBytes} of ${expectedSize} bytes).`
    );
  }

  return { sorted, uploadedBytes };
}

function isNoSuchUpload(error) {
  const name = String(error?.name || '');
  const code = String(error?.Code || error?.code || '');
  return name === 'NoSuchUpload' || code === 'NoSuchUpload';
}

function isObjectNotFound(error) {
  const name = String(error?.name || '');
  const code = String(error?.Code || error?.code || '');
  return error?.$metadata?.httpStatusCode === 404
    || name === 'NotFound'
    || name === 'NoSuchKey'
    || code === 'NotFound'
    || code === 'NoSuchKey';
}

async function inspectFinalObject(session) {
  try {
    const object = await headObject({ objectKey: session.objectKey });
    const size = Number(object.contentLength);
    if (!Number.isSafeInteger(size)) return { state: 'mismatch', object };
    return size === session.fileSize
      ? { state: 'completed', object }
      : { state: 'mismatch', object };
  } catch (error) {
    if (isObjectNotFound(error)) return { state: 'missing', object: null };
    throw error;
  }
}

async function persistRecoveredCompletion(session, object) {
  await prisma.datasetUploadSession.update({
    where: { id: session.id },
    data: {
      status: 'completed',
      etag: object?.etag || null,
      checksumSha256: object?.checksumSHA256 || null,
      completedAt: new Date(),
    },
  });
}

async function markSessionAborted(session) {
  await prisma.datasetUploadSession.update({
    where: { id: session.id },
    data: {
      status: 'aborted',
      abortedAt: new Date(),
    },
  });
}

function sendError(res, error, operation) {
  console.error(`Dataset multipart ${operation} failed:`, error);

  if (error?.statusCode) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code || undefined });
  }

  const name = String(error?.name || '');
  const code = String(error?.Code || error?.code || '');
  if (name === 'NoSuchUpload' || code === 'NoSuchUpload') {
    return res.status(404).json({
      error: 'Multipart upload no longer exists. It may have been completed or aborted.',
      code: 'MULTIPART_NOT_FOUND',
    });
  }
  if (name === 'AccessDenied' || code === 'AccessDenied') {
    return res.status(502).json({
      error: 'MinIO rejected the storage request.',
      code: 'DATASET_STORAGE_ACCESS_DENIED',
    });
  }
  if (name.startsWith('Prisma') || code.startsWith('P')) {
    return res.status(503).json({
      error: 'Dataset upload state is temporarily unavailable.',
      code: 'DATASET_STATE_UNAVAILABLE',
    });
  }

  return res.status(503).json({
    error: 'Dataset storage service is temporarily unavailable.',
    code: 'DATASET_STORAGE_UNAVAILABLE',
  });
}

// POST /api/dataset-upload/init
export async function initDatasetUpload(req, res) {
  try {
    const fileName = sanitizeFileName(req.body?.fileName);
    const fileSize = normalizeFileSize(req.body?.fileSize);
    const mimeType = normalizeMimeType(req.body?.mimeType);
    const partSize = choosePartSize(fileSize);
    const objectKey = makeObjectKey(req.user.id, fileName);

    const created = await createMultipartUpload({
      objectKey,
      contentType: mimeType,
      metadata: {
        'original-filename': encodeURIComponent(fileName),
        'uploaded-by': req.user.id,
      },
      // Phase 7: MinIO validates each browser-computed SHA-256 part digest.
      useSha256Checksums: true,
    });

    let persisted;
    try {
      persisted = await prisma.datasetUploadSession.create({
        data: {
          userId: req.user.id,
          uploadId: created.uploadId,
          objectKey: created.objectKey,
          fileName,
          fileSize: BigInt(fileSize),
          mimeType,
          partSize: BigInt(partSize),
          checksumAlgorithm: created.checksumAlgorithm || CHECKSUM_ALGORITHM_SHA256,
          status: 'initiated',
        },
      });
    } catch (databaseError) {
      // Do not leave an orphaned multipart upload when the durable control
      // plane cannot be created. Best-effort cleanup, then surface the DB error.
      try {
        await abortMultipartUpload({
          objectKey: created.objectKey,
          uploadId: created.uploadId,
        });
      } catch (cleanupError) {
        console.error('Failed to clean up MinIO upload after session persistence error:', cleanupError);
      }
      throw databaseError;
    }

    const sessionToken = createDatasetUploadSession({
      userId: req.user.id,
      sessionId: persisted.id,
    });

    return res.status(201).json({
      success: true,
      sessionId: persisted.id,
      sessionToken,
      uploadId: created.uploadId,
      objectKey: created.objectKey,
      fileName,
      fileSize,
      mimeType,
      partSize,
      totalParts: Math.ceil(fileSize / partSize),
      checksumAlgorithm: persisted.checksumAlgorithm || null,
      uploadStatus: persisted.status,
    });
  } catch (error) {
    return sendError(res, error, 'init');
  }
}

// POST /api/dataset-upload/part-url
export async function getPartUploadUrl(req, res) {
  try {
    const session = await getPersistedSession(req);
    assertSessionCanUpload(session);

    const partNumber = assertPartNumber(req.body?.partNumber);
    const totalParts = Math.ceil(session.fileSize / session.partSize);
    if (partNumber > totalParts) {
      throw httpError(400, `partNumber exceeds this upload's ${totalParts} expected parts.`);
    }

    const checksumSHA256 = session.checksumAlgorithm === CHECKSUM_ALGORITHM_SHA256
      ? normalizeSha256ChecksumBase64(req.body?.checksumSHA256)
      : undefined;

    const signed = await createPresignedPartUrl({
      objectKey: session.objectKey,
      uploadId: session.uploadId,
      partNumber,
      checksumSHA256,
    });

    // Touch updatedAt for every real part request. Stale-session cleanup uses
    // this durable activity timestamp, so a long but actively progressing
    // upload must never be mistaken for an abandoned one.
    await prisma.datasetUploadSession.update({
      where: { id: session.id },
      data: { status: session.status === 'initiated' ? 'uploading' : session.status },
    });

    return res.json({
      success: true,
      partNumber: signed.partNumber,
      url: signed.url,
      expiresIn: signed.expiresIn,
      requiredHeaders: signed.requiredHeaders,
    });
  } catch (error) {
    return sendError(res, error, 'part-url');
  }
}

// GET /api/dataset-upload/status
export async function getDatasetUploadStatus(req, res) {
  try {
    const session = await getPersistedSession(req);

    if (session.status === 'completed') {
      return res.json({
        success: true,
        uploadStatus: 'completed',
        fileName: session.fileName,
        fileSize: session.fileSize,
        partSize: session.partSize,
        totalParts: Math.ceil(session.fileSize / session.partSize),
        checksumAlgorithm: session.checksumAlgorithm || null,
        wholeFileSha256: session.wholeFileSha256 || null,
        uploadedBytes: session.fileSize,
        completedParts: [],
        objectKey: session.objectKey,
        etag: session.etag,
        checksumSHA256: session.checksumSha256,
        versionId: session.versionId,
      });
    }

    if (session.status === 'aborted' || session.status === 'failed') {
      return res.json({
        success: true,
        uploadStatus: session.status,
        fileName: session.fileName,
        fileSize: session.fileSize,
        partSize: session.partSize,
        totalParts: Math.ceil(session.fileSize / session.partSize),
        checksumAlgorithm: session.checksumAlgorithm || null,
        wholeFileSha256: session.wholeFileSha256 || null,
        uploadedBytes: 0,
        completedParts: [],
      });
    }

    let result;
    try {
      result = await listUploadedParts({
        objectKey: session.objectKey,
        uploadId: session.uploadId,
      });
    } catch (error) {
      const name = String(error?.name || '');
      const code = String(error?.Code || error?.code || '');
      if (name !== 'NoSuchUpload' && code !== 'NoSuchUpload') throw error;

      // A browser restart can hit /status after MinIO completion won the race
      // but before Prisma recorded it. Reuse the same Phase 4.1 safety rule:
      // only repair the session when the final object exists at the exact size.
      let finalObject;
      try {
        finalObject = await headObject({ objectKey: session.objectKey });
      } catch {
        throw error;
      }

      const finalSize = Number(finalObject.contentLength);
      if (!Number.isSafeInteger(finalSize) || finalSize !== session.fileSize) {
        throw error;
      }

      await prisma.datasetUploadSession.update({
        where: { id: session.id },
        data: {
          status: 'completed',
          etag: finalObject.etag || null,
          checksumSha256: finalObject.checksumSHA256 || null,
          completedAt: new Date(),
        },
      });

      return res.json({
        success: true,
        uploadStatus: 'completed',
        fileName: session.fileName,
        fileSize: session.fileSize,
        partSize: session.partSize,
        totalParts: Math.ceil(session.fileSize / session.partSize),
        checksumAlgorithm: session.checksumAlgorithm || null,
        wholeFileSha256: session.wholeFileSha256 || null,
        uploadedBytes: session.fileSize,
        completedParts: [],
        objectKey: session.objectKey,
        etag: finalObject.etag || null,
        checksumSHA256: finalObject.checksumSHA256 || null,
        versionId: session.versionId,
      });
    }
    const uploadedBytes = result.parts.reduce((sum, part) => sum + Number(part.size || 0), 0);

    if (result.parts.length > 0 && session.status === 'initiated') {
      await prisma.datasetUploadSession.update({
        where: { id: session.id },
        data: { status: 'uploading' },
      });
    }

    return res.json({
      success: true,
      uploadStatus: result.parts.length > 0 ? 'uploading' : session.status,
      fileName: session.fileName,
      fileSize: session.fileSize,
      partSize: session.partSize,
      totalParts: Math.ceil(session.fileSize / session.partSize),
      checksumAlgorithm: session.checksumAlgorithm || null,
      wholeFileSha256: session.wholeFileSha256 || null,
      uploadedBytes,
      completedParts: result.parts,
    });
  } catch (error) {
    return sendError(res, error, 'status');
  }
}

// POST /api/dataset-upload/complete
export async function completeDatasetUpload(req, res) {
  try {
    const session = await getPersistedSession(req);
    const suppliedWholeFileSha256 = normalizeWholeFileSha256(
      req.body?.wholeFileSha256,
      { optional: true }
    );

    // A repeated completion request after a lost HTTP response is safe: once
    // Prisma says the object is completed, return the durable result instead
    // of asking MinIO to complete an uploadId that no longer exists.
    if (session.status === 'completed') {
      let durableWholeFileSha256 = session.wholeFileSha256 || null;
      if (suppliedWholeFileSha256 && suppliedWholeFileSha256 !== durableWholeFileSha256) {
        if (durableWholeFileSha256) {
          throw httpError(409, 'The supplied whole-file checksum does not match the completed upload.');
        }
        const updated = await prisma.datasetUploadSession.update({
          where: { id: session.id },
          data: { wholeFileSha256: suppliedWholeFileSha256 },
          select: { wholeFileSha256: true },
        });
        durableWholeFileSha256 = updated.wholeFileSha256;
      }
      return res.json({
        success: true,
        fileName: session.fileName,
        fileSize: session.fileSize,
        mimeType: session.mimeType,
        uploadedBytes: session.fileSize,
        objectKey: session.objectKey,
        etag: session.etag,
        checksumSHA256: session.checksumSha256,
        wholeFileSha256: durableWholeFileSha256,
        versionId: session.versionId,
        storageProvider: 'minio',
        uploadStatus: 'completed',
      });
    }
    assertSessionCanUpload(session);

    try {
      // MinIO is the source of truth. Do not trust ETags/part lists supplied by
      // the browser when completing a large scientific dataset.
      const listed = await listUploadedParts({
        objectKey: session.objectKey,
        uploadId: session.uploadId,
      });
      const { sorted, uploadedBytes } = verifyUploadedByteCount(
        listed.parts,
        session.fileSize,
        session.partSize
      );
      verifyUploadedChecksums(sorted, session.checksumAlgorithm);

      const completed = await completeMultipartUpload({
        objectKey: session.objectKey,
        uploadId: session.uploadId,
        parts: sorted,
      });

      // If this DB write fails after MinIO has completed the upload, leave the
      // final object intact. A later retry can recover the durable state below.
      await prisma.datasetUploadSession.update({
        where: { id: session.id },
        data: {
          status: 'completed',
          etag: completed.etag || null,
          checksumSha256: completed.checksumSHA256 || null,
          wholeFileSha256: suppliedWholeFileSha256,
          versionId: completed.versionId || null,
          completedAt: new Date(),
        },
      });

      return res.json({
        success: true,
        fileName: session.fileName,
        fileSize: session.fileSize,
        mimeType: session.mimeType,
        uploadedBytes,
        objectKey: completed.objectKey,
        etag: completed.etag,
        checksumSHA256: completed.checksumSHA256,
        wholeFileSha256: suppliedWholeFileSha256,
        versionId: completed.versionId,
        storageProvider: 'minio',
        uploadStatus: 'completed',
      });
    } catch (error) {
      const name = String(error?.name || '');
      const code = String(error?.Code || error?.code || '');
      if (name !== 'NoSuchUpload' && code !== 'NoSuchUpload') throw error;

      // Recovery for the narrow race where CompleteMultipartUpload succeeded
      // in MinIO but persisting status=completed failed. The multipart upload
      // no longer exists, so verify the final object before repairing DB state.
      let finalObject;
      try {
        finalObject = await headObject({ objectKey: session.objectKey });
      } catch {
        throw error;
      }

      const finalSize = Number(finalObject.contentLength);
      if (!Number.isSafeInteger(finalSize) || finalSize !== session.fileSize) {
        throw error;
      }

      await prisma.datasetUploadSession.update({
        where: { id: session.id },
        data: {
          status: 'completed',
          etag: finalObject.etag || null,
          checksumSha256: finalObject.checksumSHA256 || null,
          wholeFileSha256: suppliedWholeFileSha256,
          completedAt: new Date(),
        },
      });

      return res.json({
        success: true,
        fileName: session.fileName,
        fileSize: session.fileSize,
        mimeType: session.mimeType,
        uploadedBytes: session.fileSize,
        objectKey: session.objectKey,
        etag: finalObject.etag,
        checksumSHA256: finalObject.checksumSHA256,
        wholeFileSha256: suppliedWholeFileSha256,
        versionId: session.versionId,
        storageProvider: 'minio',
        uploadStatus: 'completed',
      });
    }
  } catch (error) {
    return sendError(res, error, 'complete');
  }
}

// DELETE /api/dataset-upload/abort
export async function abortDatasetUpload(req, res) {
  try {
    const session = await getPersistedSession(req);

    if (session.status === 'aborted') {
      return res.json({ success: true, aborted: true, uploadStatus: 'aborted' });
    }
    if (session.status === 'completed') {
      throw httpError(409, 'Completed dataset uploads cannot be aborted.');
    }

    try {
      await abortMultipartUpload({
        objectKey: session.objectKey,
        uploadId: session.uploadId,
      });
    } catch (error) {
      const name = String(error?.name || '');
      const code = String(error?.Code || error?.code || '');
      if (name !== 'NoSuchUpload' && code !== 'NoSuchUpload') throw error;

      // A missing multipart upload may mean completion won a race just before
      // this abort request. Never delete or mark that object aborted blindly:
      // verify the final object first and repair durable state when it matches.
      let finalObject;
      try {
        finalObject = await headObject({ objectKey: session.objectKey });
      } catch {
        throw error;
      }

      const finalSize = Number(finalObject.contentLength);
      if (!Number.isSafeInteger(finalSize) || finalSize !== session.fileSize) {
        throw error;
      }

      await prisma.datasetUploadSession.update({
        where: { id: session.id },
        data: {
          status: 'completed',
          etag: finalObject.etag || null,
          checksumSha256: finalObject.checksumSHA256 || null,
          completedAt: new Date(),
        },
      });

      return res.status(409).json({
        error: 'Dataset upload already completed and cannot be aborted.',
        code: 'UPLOAD_ALREADY_COMPLETED',
        uploadStatus: 'completed',
      });
    }

    await prisma.datasetUploadSession.update({
      where: { id: session.id },
      data: {
        status: 'aborted',
        abortedAt: new Date(),
      },
    });

    return res.json({ success: true, aborted: true, uploadStatus: 'aborted' });
  } catch (error) {
    return sendError(res, error, 'abort');
  }
}

// POST /api/dataset-upload/session-token
// Reissue a bearer session token only to the authenticated owner. This keeps
// logout/account switching safe: IndexedDB can scrub the old token without
// destroying the resumable session metadata or the MinIO multipart upload.
export async function reissueDatasetUploadSessionToken(req, res) {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) throw httpError(400, 'sessionId is required.');

    const record = await prisma.datasetUploadSession.findUnique({ where: { id: sessionId } });
    if (!record) throw httpError(404, 'Dataset upload session was not found.');
    if (record.userId !== req.user.id) {
      throw httpError(403, 'This dataset upload session belongs to another user.');
    }
    if (record.status === 'aborted' || record.status === 'failed') {
      throw httpError(409, `Dataset upload is ${record.status} and cannot be resumed.`);
    }

    return res.json({
      success: true,
      sessionId: record.id,
      sessionToken: createDatasetUploadSession({ userId: req.user.id, sessionId: record.id }),
      uploadStatus: record.status,
    });
  } catch (error) {
    return sendError(res, error, 'session-token');
  }
}

// POST /api/dataset-upload/cleanup-stale
// Conservative owner-scoped cleanup for server-side multipart sessions older
// than seven days. Completed objects are never deleted. Before aborting an
// incomplete multipart upload, HEAD verifies that a final object has not
// already won a completion race.
export async function cleanupStaleDatasetUploads(req, res) {
  try {
    const cutoff = new Date(Date.now() - STALE_UPLOAD_MAX_AGE_MS);
    const records = await prisma.datasetUploadSession.findMany({
      where: {
        userId: req.user.id,
        updatedAt: { lt: cutoff },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });

    const results = [];

    for (const raw of records) {
      const session = toRuntimeSession(raw);

      if (session.status === 'completed' || session.status === 'aborted' || session.status === 'failed') {
        results.push({ sessionId: session.id, status: session.status, action: 'preserved' });
        continue;
      }

      try {
        const finalState = await inspectFinalObject(session);
        if (finalState.state === 'completed') {
          await persistRecoveredCompletion(session, finalState.object);
          results.push({ sessionId: session.id, status: 'completed', action: 'recovered' });
          continue;
        }
        if (finalState.state === 'mismatch') {
          // A final object exists but does not match the expected size. Never
          // abort/delete around an ambiguous object; leave it for manual review.
          results.push({ sessionId: session.id, status: session.status, action: 'skipped-size-mismatch' });
          continue;
        }

        try {
          await listUploadedParts({ objectKey: session.objectKey, uploadId: session.uploadId });
        } catch (error) {
          if (!isNoSuchUpload(error)) throw error;

          // Re-check HEAD after NoSuchUpload because completion may have raced
          // between the initial HEAD and ListParts.
          const racedFinalState = await inspectFinalObject(session);
          if (racedFinalState.state === 'completed') {
            await persistRecoveredCompletion(session, racedFinalState.object);
            results.push({ sessionId: session.id, status: 'completed', action: 'recovered' });
            continue;
          }
          if (racedFinalState.state === 'mismatch') {
            results.push({ sessionId: session.id, status: session.status, action: 'skipped-size-mismatch' });
            continue;
          }

          await markSessionAborted(session);
          results.push({ sessionId: session.id, status: 'aborted', action: 'marked-aborted' });
          continue;
        }

        try {
          await abortMultipartUpload({ objectKey: session.objectKey, uploadId: session.uploadId });
          await markSessionAborted(session);
          results.push({ sessionId: session.id, status: 'aborted', action: 'aborted' });
        } catch (error) {
          if (!isNoSuchUpload(error)) throw error;

          const racedFinalState = await inspectFinalObject(session);
          if (racedFinalState.state === 'completed') {
            await persistRecoveredCompletion(session, racedFinalState.object);
            results.push({ sessionId: session.id, status: 'completed', action: 'recovered' });
          } else if (racedFinalState.state === 'missing') {
            await markSessionAborted(session);
            results.push({ sessionId: session.id, status: 'aborted', action: 'marked-aborted' });
          } else {
            results.push({ sessionId: session.id, status: session.status, action: 'skipped-size-mismatch' });
          }
        }
      } catch (error) {
        console.error(`Stale dataset upload cleanup skipped session ${session.id}:`, error);
        results.push({ sessionId: session.id, status: session.status, action: 'skipped-error' });
      }
    }

    return res.json({
      success: true,
      expiryDays: 7,
      checked: records.length,
      results,
    });
  } catch (error) {
    return sendError(res, error, 'cleanup-stale');
  }
}

// Exported only for isolated Phase 3 tests; these do not alter runtime behavior.
export const __phase3Testables = {
  sanitizeFileName,
  normalizeFileSize,
  normalizeMimeType,
  choosePartSize,
  assertPartNumber,
  normalizeSha256ChecksumBase64,
  verifyUploadedChecksums,
  verifyUploadedByteCount,
};
