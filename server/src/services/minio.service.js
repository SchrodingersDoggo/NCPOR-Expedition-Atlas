import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertMinioConfig,
  createMinioClient,
  getMinioConfig,
} from '../config/minio.js';

const MAX_MULTIPART_PARTS = 10_000;
const MIN_PART_NUMBER = 1;
const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

function requireNonEmptyString(value, fieldName) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${fieldName} is required.`);
  return text;
}

function requirePartNumber(value) {
  const partNumber = Number(value);
  if (
    !Number.isInteger(partNumber) ||
    partNumber < MIN_PART_NUMBER ||
    partNumber > MAX_MULTIPART_PARTS
  ) {
    throw new Error(`partNumber must be an integer between 1 and ${MAX_MULTIPART_PARTS}.`);
  }
  return partNumber;
}

function normalizeExpiry(value, fallback, fieldName) {
  const seconds = Number(value ?? fallback);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > MAX_PRESIGN_SECONDS) {
    throw new Error(`${fieldName} must be an integer between 60 and ${MAX_PRESIGN_SECONDS} seconds.`);
  }
  return seconds;
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;

  const entries = Object.entries(metadata)
    .filter(([key, value]) => String(key).trim() && value != null)
    .map(([key, value]) => [String(key).trim(), String(value)]);

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeCompletedPart(part) {
  if (!part || typeof part !== 'object') {
    throw new Error('Each completed part must be an object.');
  }

  const PartNumber = requirePartNumber(part.partNumber ?? part.PartNumber);
  const ETag = requireNonEmptyString(part.etag ?? part.ETag, `ETag for part ${PartNumber}`);

  const normalized = { PartNumber, ETag };
  const checksumSHA256 = String(part.checksumSHA256 ?? part.ChecksumSHA256 ?? '').trim();
  if (checksumSHA256) normalized.ChecksumSHA256 = checksumSHA256;

  return normalized;
}

function normalizeListedPart(part) {
  return {
    partNumber: part.PartNumber,
    etag: part.ETag,
    size: part.Size,
    lastModified: part.LastModified || null,
    checksumSHA256: part.ChecksumSHA256 || null,
  };
}

/**
 * Creates a MinIO/S3 storage service without coupling it to Express or Prisma.
 * File bytes never pass through this service; it only manages multipart state
 * and signs URLs which the browser will use to communicate directly with MinIO.
 */
export function createMinioStorageService({
  client,
  config,
  signUrl = getSignedUrl,
} = {}) {
  const resolvedConfig = assertMinioConfig(config || getMinioConfig());
  const s3 = client || createMinioClient(resolvedConfig);

  const defaultPartUrlExpirySeconds = normalizeExpiry(
    resolvedConfig.partUrlExpirySeconds,
    3600,
    'MINIO_PART_URL_EXPIRY_SECONDS'
  );
  const defaultDownloadUrlExpirySeconds = normalizeExpiry(
    resolvedConfig.downloadUrlExpirySeconds,
    900,
    'MINIO_DOWNLOAD_URL_EXPIRY_SECONDS'
  );

  async function createMultipartUpload({
    objectKey,
    contentType = 'application/octet-stream',
    metadata,
    useSha256Checksums = false,
  }) {
    const Key = requireNonEmptyString(objectKey, 'objectKey');
    const ContentType = String(contentType || 'application/octet-stream').trim();

    const command = new CreateMultipartUploadCommand({
      Bucket: resolvedConfig.bucket,
      Key,
      ContentType,
      Metadata: normalizeMetadata(metadata),
      ...(useSha256Checksums ? { ChecksumAlgorithm: 'SHA256' } : {}),
    });

    const response = await s3.send(command);
    const uploadId = requireNonEmptyString(response.UploadId, 'MinIO uploadId');

    return {
      uploadId,
      objectKey: Key,
      bucket: resolvedConfig.bucket,
      checksumAlgorithm: useSha256Checksums ? 'SHA256' : null,
    };
  }

  async function createPresignedPartUrl({
    objectKey,
    uploadId,
    partNumber,
    checksumSHA256,
    expiresIn = defaultPartUrlExpirySeconds,
  }) {
    const Key = requireNonEmptyString(objectKey, 'objectKey');
    const UploadId = requireNonEmptyString(uploadId, 'uploadId');
    const PartNumber = requirePartNumber(partNumber);
    const expirySeconds = normalizeExpiry(
      expiresIn,
      defaultPartUrlExpirySeconds,
      'part URL expiry'
    );

    const checksum = String(checksumSHA256 || '').trim();
    const input = {
      Bucket: resolvedConfig.bucket,
      Key,
      UploadId,
      PartNumber,
      ...(checksum ? { ChecksumSHA256: checksum } : {}),
    };

    const command = new UploadPartCommand(input);
    const url = await signUrl(s3, command, { expiresIn: expirySeconds });

    return {
      url,
      expiresIn: expirySeconds,
      partNumber: PartNumber,
      requiredHeaders: checksum
        ? { 'x-amz-checksum-sha256': checksum }
        : {},
    };
  }

  async function listUploadedParts({ objectKey, uploadId }) {
    const Key = requireNonEmptyString(objectKey, 'objectKey');
    const UploadId = requireNonEmptyString(uploadId, 'uploadId');

    const parts = [];
    let PartNumberMarker;

    do {
      const response = await s3.send(
        new ListPartsCommand({
          Bucket: resolvedConfig.bucket,
          Key,
          UploadId,
          ...(PartNumberMarker ? { PartNumberMarker } : {}),
        })
      );

      for (const part of response.Parts || []) {
        if (part?.PartNumber != null && part?.ETag) {
          parts.push(normalizeListedPart(part));
        }
      }

      PartNumberMarker = response.IsTruncated
        ? response.NextPartNumberMarker
        : undefined;
    } while (PartNumberMarker != null);

    parts.sort((a, b) => a.partNumber - b.partNumber);

    return {
      objectKey: Key,
      uploadId: UploadId,
      parts,
    };
  }

  async function completeMultipartUpload({
    objectKey,
    uploadId,
    parts,
  }) {
    const Key = requireNonEmptyString(objectKey, 'objectKey');
    const UploadId = requireNonEmptyString(uploadId, 'uploadId');

    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error('At least one completed multipart part is required.');
    }

    const normalizedParts = parts.map(normalizeCompletedPart).sort(
      (a, b) => a.PartNumber - b.PartNumber
    );

    for (let index = 1; index < normalizedParts.length; index += 1) {
      if (normalizedParts[index - 1].PartNumber === normalizedParts[index].PartNumber) {
        throw new Error(`Duplicate multipart part number: ${normalizedParts[index].PartNumber}.`);
      }
    }

    const checksumParts = normalizedParts.filter((part) => part.ChecksumSHA256);
    if (checksumParts.length > 0) {
      if (checksumParts.length !== normalizedParts.length) {
        throw new Error('When SHA-256 multipart checksums are used, every completed part needs a checksum.');
      }
      normalizedParts.forEach((part, index) => {
        if (part.PartNumber !== index + 1) {
          throw new Error('SHA-256 checksum multipart uploads require consecutive part numbers starting at 1.');
        }
      });
    }

    const response = await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: resolvedConfig.bucket,
        Key,
        UploadId,
        MultipartUpload: { Parts: normalizedParts },
      })
    );

    return {
      objectKey: Key,
      bucket: resolvedConfig.bucket,
      etag: response.ETag || null,
      checksumSHA256: response.ChecksumSHA256 || null,
      versionId: response.VersionId || null,
    };
  }

  async function abortMultipartUpload({ objectKey, uploadId }) {
    const Key = requireNonEmptyString(objectKey, 'objectKey');
    const UploadId = requireNonEmptyString(uploadId, 'uploadId');

    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: resolvedConfig.bucket,
        Key,
        UploadId,
      })
    );

    return { aborted: true, objectKey: Key, uploadId: UploadId };
  }

  async function createPresignedDownloadUrl({
    objectKey,
    fileName,
    expiresIn = defaultDownloadUrlExpirySeconds,
  }) {
    const Key = requireNonEmptyString(objectKey, 'objectKey');
    const expirySeconds = normalizeExpiry(
      expiresIn,
      defaultDownloadUrlExpirySeconds,
      'download URL expiry'
    );

    const safeFileName = String(fileName || '').replace(/[\r\n"]/g, '').trim();
    const command = new GetObjectCommand({
      Bucket: resolvedConfig.bucket,
      Key,
      ...(safeFileName
        ? { ResponseContentDisposition: `attachment; filename="${safeFileName}"` }
        : {}),
    });

    const url = await signUrl(s3, command, { expiresIn: expirySeconds });
    return { url, expiresIn: expirySeconds };
  }

  async function headObject({ objectKey }) {
    const Key = requireNonEmptyString(objectKey, 'objectKey');
    const response = await s3.send(
      new HeadObjectCommand({ Bucket: resolvedConfig.bucket, Key })
    );

    return {
      objectKey: Key,
      contentLength: response.ContentLength ?? null,
      contentType: response.ContentType || null,
      etag: response.ETag || null,
      checksumSHA256: response.ChecksumSHA256 || null,
      versionId: response.VersionId || null,
      lastModified: response.LastModified || null,
      metadata: response.Metadata || {},
    };
  }

  function destroy() {
    if (!client && typeof s3.destroy === 'function') s3.destroy();
  }

  return {
    createMultipartUpload,
    createPresignedPartUrl,
    listUploadedParts,
    completeMultipartUpload,
    abortMultipartUpload,
    createPresignedDownloadUrl,
    headObject,
    destroy,
  };
}

let defaultService;

function getDefaultService() {
  if (!defaultService) defaultService = createMinioStorageService();
  return defaultService;
}

export const createMultipartUpload = (input) =>
  getDefaultService().createMultipartUpload(input);
export const createPresignedPartUrl = (input) =>
  getDefaultService().createPresignedPartUrl(input);
export const listUploadedParts = (input) =>
  getDefaultService().listUploadedParts(input);
export const completeMultipartUpload = (input) =>
  getDefaultService().completeMultipartUpload(input);
export const abortMultipartUpload = (input) =>
  getDefaultService().abortMultipartUpload(input);
export const createPresignedDownloadUrl = (input) =>
  getDefaultService().createPresignedDownloadUrl(input);
export const headObject = (input) =>
  getDefaultService().headObject(input);
// Backward-compatible alias for any existing callers.
export const headMinioObject = headObject;
