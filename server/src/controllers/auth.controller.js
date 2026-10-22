import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma.js';

// Only these two are ever self-registerable — comms_officer and admin are
// assigned later by an existing admin (see account.controller.js), never
// chosen at signup. Enforced here too (not just hidden in the UI) since
// the register endpoint is public and nothing stops a direct API call
// from sending any string it likes.
const SELF_REGISTERABLE_ROLES = new Set(['researcher', 'public']);

const PUBLIC_USER_SELECT = {
  id: true, name: true, email: true, role: true, accountStatus: true,
  title: true, firstName: true, lastName: true, preferredName: true,
  designation: true, organization: true, organisationWebsite: true,
  personalProfileUrl: true, communicationAddress: true, alternateEmail: true,
  mobileNumber: true, createdAt: true,
};

// POST /api/auth/register
// Registration fields follow the NPDC user guidelines' own registration
// form (Section 1.4) — see RegisterPage.jsx for the matching UI.
export const register = async (req, res) => {
  const {
    title, first_name, last_name, preferred_name,
    email, confirm_email, password, confirm_password,
    designation, organisation_name, organisation_website,
    personal_profile_url, communication_address,
    alternate_email, mobile_number,
    role,
  } = req.body;

  if (!first_name || !String(first_name).trim()) return res.status(400).json({ error: 'First name is required' });
  if (!last_name || !String(last_name).trim()) return res.status(400).json({ error: 'Last name is required' });
  if (!email || !String(email).trim()) return res.status(400).json({ error: 'Email is required' });
  if (confirm_email !== undefined && email !== confirm_email) {
    return res.status(400).json({ error: 'Email and confirmation email do not match' });
  }
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (confirm_password !== undefined && password !== confirm_password) {
    return res.status(400).json({ error: 'Password and confirmation do not match' });
  }
  if (!organisation_name || !String(organisation_name).trim()) {
    return res.status(400).json({ error: 'Organisation name is required' });
  }

  const safeRole = SELF_REGISTERABLE_ROLES.has(role) ? role : 'public';
  const displayName = `${first_name.trim()} ${last_name.trim()}`.trim();

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name: displayName,
        email: email.trim().toLowerCase(),
        passwordHash,
        role: safeRole,
        // Every new self-registration starts pending, regardless of what
        // (if anything) the request body claims — this can only ever be
        // moved forward by an admin/comms_officer via the Account
        // Approval endpoints, never by the registration request itself.
        accountStatus: 'pending',
        organization: organisation_name.trim(),
        title: title || null,
        firstName: first_name.trim(),
        lastName: last_name.trim(),
        preferredName: preferred_name || null,
        designation: designation || null,
        organisationWebsite: organisation_website || null,
        personalProfileUrl: personal_profile_url || null,
        communicationAddress: communication_address || null,
        alternateEmail: alternate_email || null,
        mobileNumber: mobile_number || null,
      },
      select: PUBLIC_USER_SELECT,
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
};

// POST /api/auth/login
export const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // accountStatus travels in the JWT itself (same pattern as role/email
    // already did) so every protected route can check it with zero extra
    // DB lookups — the standard JWT tradeoff is that this is frozen at
    // login time: a user approved (or suspended) mid-session only sees
    // that change reflected after their next login/token refresh.
    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email, accountStatus: user.accountStatus },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, accountStatus: user.accountStatus },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
