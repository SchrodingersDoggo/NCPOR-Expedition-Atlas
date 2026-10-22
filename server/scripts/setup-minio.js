import dotenv from 'dotenv';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import {
  assertMinioConfig,
  createMinioClient,
  getMinioConfig,
} from '../src/config/minio.js';

dotenv.config();

const config = assertMinioConfig(getMinioConfig());
const client = createMinioClient(config);

async function ensureBucket() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    console.log(`✓ Bucket exists: ${config.bucket}`);
    return;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const missingBucket = status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchBucket';

    if (!missingBucket) throw error;
  }

  await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  console.log(`✓ Created private bucket: ${config.bucket}`);
}

async function configureCors() {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: config.bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [config.corsOrigin],
            AllowedMethods: ['GET', 'PUT', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: [
              'ETag',
              'x-amz-checksum-sha256',
              'Content-Range',
              'Accept-Ranges',
              'Content-Length',
            ],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );

  console.log(`✓ Bucket CORS allows direct browser access from: ${config.corsOrigin}`);
}

async function main() {
  console.log(`Connecting to MinIO/S3 endpoint: ${config.url}`);
  await ensureBucket();
  await configureCors();
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  console.log('✓ MinIO Phase 1 setup complete. Backend credentials and bucket access are working.');
  console.log('✓ Existing Cloudinary upload behavior was not changed.');
}

main()
  .catch((error) => {
    console.error('✗ MinIO Phase 1 setup failed.');
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => client.destroy());
