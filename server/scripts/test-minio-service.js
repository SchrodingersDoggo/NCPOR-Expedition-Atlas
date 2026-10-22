import assert from 'node:assert/strict';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createMinioStorageService } from '../src/services/minio.service.js';

const sentCommands = [];
let listCall = 0;

const fakeClient = {
  async send(command) {
    sentCommands.push(command);

    if (command instanceof CreateMultipartUploadCommand) {
      return { UploadId: 'upload-test-123' };
    }
    if (command instanceof ListPartsCommand) {
      listCall += 1;
      if (listCall === 1) {
        return {
          Parts: [{ PartNumber: 2, ETag: '"etag-2"', Size: 5 }],
          IsTruncated: true,
          NextPartNumberMarker: 2,
        };
      }
      return {
        Parts: [{ PartNumber: 1, ETag: '"etag-1"', Size: 5 }],
        IsTruncated: false,
      };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      return { ETag: '"final-etag"', ChecksumSHA256: 'final-checksum' };
    }
    if (command instanceof AbortMultipartUploadCommand) return {};
    if (command instanceof HeadObjectCommand) {
      return {
        ContentLength: 10,
        ContentType: 'application/octet-stream',
        ETag: '"final-etag"',
      };
    }
    throw new Error(`Unexpected command: ${command.constructor.name}`);
  },
};

const signedCommands = [];
const fakeSigner = async (_client, command, options) => {
  signedCommands.push({ command, options });
  return `https://minio.test/signed/${command.constructor.name}`;
};

const service = createMinioStorageService({
  client: fakeClient,
  signUrl: fakeSigner,
  config: {
    endpoint: 'localhost',
    port: '9000',
    useSSL: false,
    accessKey: 'test-access',
    secretKey: 'test-secret',
    bucket: 'ncpor-datasets',
    region: 'us-east-1',
    corsOrigin: 'http://localhost:5173',
    url: 'http://localhost:9000',
    partUrlExpirySeconds: 3600,
    downloadUrlExpirySeconds: 900,
  },
});

const created = await service.createMultipartUpload({
  objectKey: 'datasets/user-1/sample.nc',
  contentType: 'application/x-netcdf',
  metadata: { originalName: 'sample.nc' },
  useSha256Checksums: true,
});
assert.equal(created.uploadId, 'upload-test-123');
assert.equal(created.checksumAlgorithm, 'SHA256');
const createCommand = sentCommands.find((c) => c instanceof CreateMultipartUploadCommand);
assert.equal(createCommand.input.ChecksumAlgorithm, 'SHA256');

const part = await service.createPresignedPartUrl({
  objectKey: created.objectKey,
  uploadId: created.uploadId,
  partNumber: 3,
  checksumSHA256: 'base64-checksum',
});
assert.equal(part.partNumber, 3);
assert.equal(part.expiresIn, 3600);
assert.equal(part.requiredHeaders['x-amz-checksum-sha256'], 'base64-checksum');
assert(signedCommands[0].command instanceof UploadPartCommand);
assert.equal(signedCommands[0].command.input.ChecksumSHA256, 'base64-checksum');

const listed = await service.listUploadedParts({
  objectKey: created.objectKey,
  uploadId: created.uploadId,
});
assert.deepEqual(listed.parts.map((p) => p.partNumber), [1, 2]);
assert.equal(listCall, 2);

await service.completeMultipartUpload({
  objectKey: created.objectKey,
  uploadId: created.uploadId,
  parts: [
    { partNumber: 2, etag: '"etag-2"', checksumSHA256: 'checksum-2' },
    { partNumber: 1, etag: '"etag-1"', checksumSHA256: 'checksum-1' },
  ],
});
const completeCommand = sentCommands.find((c) => c instanceof CompleteMultipartUploadCommand);
assert.deepEqual(
  completeCommand.input.MultipartUpload.Parts.map((p) => p.PartNumber),
  [1, 2]
);

const download = await service.createPresignedDownloadUrl({
  objectKey: created.objectKey,
  fileName: 'sample.nc',
});
assert.equal(download.expiresIn, 900);
assert(signedCommands[1].command instanceof GetObjectCommand);
assert.match(signedCommands[1].command.input.ResponseContentDisposition, /sample\.nc/);

const head = await service.headObject({ objectKey: created.objectKey });
assert.equal(head.contentLength, 10);

const aborted = await service.abortMultipartUpload({
  objectKey: created.objectKey,
  uploadId: created.uploadId,
});
assert.equal(aborted.aborted, true);

await assert.rejects(
  () => service.createPresignedPartUrl({
    objectKey: created.objectKey,
    uploadId: created.uploadId,
    partNumber: 0,
  }),
  /partNumber/
);

console.log('✓ MinIO Phase 2 storage service tests passed.');
console.log('✓ Multipart create/list/complete/abort primitives validated.');
console.log('✓ Presigned part and download URL behavior validated without uploading file bytes.');
