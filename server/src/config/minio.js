import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const parseBoolean = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
};

const stripProtocolAndTrailingSlash = (value) =>
  String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

export function getMinioConfig() {
  const endpoint = stripProtocolAndTrailingSlash(process.env.MINIO_ENDPOINT);
  const port = String(process.env.MINIO_PORT || '9000').trim();
  const useSSL = parseBoolean(process.env.MINIO_USE_SSL, false);
  const accessKey = String(process.env.MINIO_ACCESS_KEY || '').trim();
  const secretKey = String(process.env.MINIO_SECRET_KEY || '').trim();
  const bucket = String(process.env.MINIO_BUCKET || 'ncpor-datasets').trim();
  const region = String(process.env.MINIO_REGION || 'us-east-1').trim();
  const corsOrigin = String(
    process.env.MINIO_CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173'
  ).trim();
  const partUrlExpirySeconds = Number(
    process.env.MINIO_PART_URL_EXPIRY_SECONDS || 3600
  );
  const downloadUrlExpirySeconds = Number(
    process.env.MINIO_DOWNLOAD_URL_EXPIRY_SECONDS || 900
  );

  return {
    endpoint,
    port,
    useSSL,
    accessKey,
    secretKey,
    bucket,
    region,
    corsOrigin,
    partUrlExpirySeconds,
    downloadUrlExpirySeconds,
    url: endpoint ? `${useSSL ? 'https' : 'http'}://${endpoint}:${port}` : '',
  };
}

export function assertMinioConfig(config = getMinioConfig()) {
  const missing = [];
  if (!config.endpoint) missing.push('MINIO_ENDPOINT');
  if (!config.port) missing.push('MINIO_PORT');
  if (!config.accessKey) missing.push('MINIO_ACCESS_KEY');
  if (!config.secretKey) missing.push('MINIO_SECRET_KEY');
  if (!config.bucket) missing.push('MINIO_BUCKET');

  if (missing.length) {
    throw new Error(
      `Missing MinIO environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
    );
  }

  const numericPort = Number(config.port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error('MINIO_PORT must be a valid TCP port (1-65535).');
  }

  return config;
}

export function createMinioClient(config = assertMinioConfig()) {
  return new S3Client({
    endpoint: config.url,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
}
