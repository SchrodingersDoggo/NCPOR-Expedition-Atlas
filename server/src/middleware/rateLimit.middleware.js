// Lightweight in-memory rate limiting for Communities endpoints.
// This intentionally has no new dependency and does not touch auth/offline logic.
// Counts reset when the server restarts, which is acceptable as a basic abuse guard.
const buckets = new Map();

function keyFor(req, name) {
  return `${name}:${req.user?.id || req.ip || 'anonymous'}`;
}

export function createRateLimit({ name, windowMs, max, message = 'Too many requests. Please try again shortly.' }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = keyFor(req, name);
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, retryAfter });
    }

    current.count += 1;
    return next();
  };
}
