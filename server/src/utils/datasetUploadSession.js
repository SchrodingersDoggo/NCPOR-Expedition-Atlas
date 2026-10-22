import jwt from 'jsonwebtoken';

const SESSION_KIND = 'dataset-multipart-upload';
const DEFAULT_SESSION_EXPIRY = '7d';

function getSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) throw new Error('JWT_SECRET is required to sign dataset upload sessions.');
  return secret;
}

// Phase 4: the signed token is now only a bearer reference to a durable
// database session. File geometry, object key and MinIO upload id are read
// from Prisma on every request, so a stale/tampered client cannot redefine
// those values by replaying token payload data.
export function createDatasetUploadSession(payload) {
  const { userId, sessionId } = payload || {};

  if (!userId || !sessionId) {
    throw new Error('Invalid dataset upload session payload.');
  }

  return jwt.sign(
    {
      kind: SESSION_KIND,
      userId,
      sessionId,
    },
    getSecret(),
    { expiresIn: process.env.MINIO_UPLOAD_SESSION_EXPIRES_IN || DEFAULT_SESSION_EXPIRY }
  );
}

export function verifyDatasetUploadSession(token, expectedUserId) {
  const value = String(token || '').trim();
  if (!value) {
    const error = new Error('Dataset upload session token is required.');
    error.statusCode = 400;
    throw error;
  }

  let decoded;
  try {
    decoded = jwt.verify(value, getSecret());
  } catch (cause) {
    const error = new Error(
      cause?.name === 'TokenExpiredError'
        ? 'Dataset upload session has expired.'
        : 'Invalid dataset upload session token.'
    );
    error.statusCode = 401;
    throw error;
  }

  if (decoded?.kind !== SESSION_KIND || !decoded.sessionId || !decoded.userId) {
    const error = new Error('Invalid dataset upload session token.');
    error.statusCode = 401;
    throw error;
  }

  if (expectedUserId && decoded.userId !== expectedUserId) {
    const error = new Error('This dataset upload session belongs to another user.');
    error.statusCode = 403;
    throw error;
  }

  return {
    sessionId: decoded.sessionId,
    userId: decoded.userId,
  };
}
