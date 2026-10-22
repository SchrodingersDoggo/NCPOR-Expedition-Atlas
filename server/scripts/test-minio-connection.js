import dotenv from 'dotenv';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import {
  assertMinioConfig,
  createMinioClient,
  getMinioConfig,
} from '../src/config/minio.js';

dotenv.config();

const config = assertMinioConfig(getMinioConfig());
const client = createMinioClient(config);

async function main() {
  console.log(`Testing MinIO connection: ${config.url}`);
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  console.log(`✓ Connected successfully and can access private bucket: ${config.bucket}`);
}

main()
  .catch((error) => {
    console.error('✗ MinIO connection test failed.');
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => client.destroy());
