import jwt from 'jsonwebtoken';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role, email }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Usage: authorize('admin', 'comms_officer')
export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Gates protected WRITE actions on account approval status, separate from
// and in addition to role (authorize above). A pending/suspended/rejected
// account can still authenticate and log in (browse their own status,
// view public content) — this only blocks the specific routes that apply
// it, same pattern as authorize: chain authenticate, then this, then
// authorize, in whatever order a route needs.
// Usage: router.post('/', authenticate, requireActiveAccount, authorize('researcher'), ...)
export function requireActiveAccount(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No token provided' });
  if (req.user.accountStatus !== 'active') {
    return res.status(403).json({
      error: 'Your account is awaiting administrator verification.',
      accountStatus: req.user.accountStatus,
    });
  }
  next();
}

// Like authenticate, but never blocks the request — attaches req.user if a
// valid token is present, otherwise leaves it undefined and continues.
// Use on routes that show different/less data to anonymous users rather
// than routes that should be fully blocked without a token.
export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    } catch {
      // invalid/expired token on an optional route — treat as anonymous
    }
  }
  next();
}
