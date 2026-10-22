import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Compass, User, Building2, Mail, Phone, ChevronRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useNetwork } from '../context/NetworkContext.jsx';

// The card itself is the app's standard brass/rivet design (.brass-plate,
// same as Login/Review/etc.) — only the page background around it is
// custom to this page, and even that stays simple (a plain gradient/flat
// color, no blur) so it degrades cleanly under low-bandwidth same as
// everything else here.

const inputStyle = { background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' };
const focusHandlers = {
  onFocus: (e) => (e.target.style.borderColor = 'var(--brass-bright)'),
  onBlur: (e) => (e.target.style.borderColor = 'var(--brass-dim)'),
};

function Field({ label, optional, children }) {
  return (
    <div>
      <label className="block text-sm mb-1" style={{ color: 'var(--ice-dim)' }}>
        {label}
        {optional && <span className="ml-1.5 text-[11px] italic" style={{ color: 'var(--brass-dim)' }}>optional</span>}
      </label>
      {children}
    </div>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      className="w-full px-3 py-2 rounded text-white focus:outline-none transition-colors"
      style={inputStyle}
      {...focusHandlers}
    />
  );
}

function SectionHeading({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-2" style={{ borderBottom: '1px solid var(--brass-dim)' }}>
      <Icon className="w-4 h-4" strokeWidth={1.5} style={{ color: 'var(--brass-bright)' }} />
      <span className="gauge-text text-[11px] tracking-wide" style={{ color: 'var(--brass-bright)' }}>{children}</span>
    </div>
  );
}

const BLANK_FORM = {
  title: '', first_name: '', last_name: '', preferred_name: '',
  email: '', confirm_email: '', password: '', confirm_password: '',
  designation: '', organisation_name: '', organisation_website: '',
  personal_profile_url: '', communication_address: '', alternate_email: '',
  mobile_number: '', role: 'researcher',
};

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  // Same principle as .chart-backdrop/.brass-plate degrading under
  // data-network-quality="medium"/"slow": this page's background gradient
  // is decorative weight it can shed on a slow link, same as everywhere
  // else in the app.
  const { isFast, isMedium } = useNetwork();

  const [form, setForm] = useState(BLANK_FORM);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.email !== form.confirm_email) {
      setError('Email and confirmation email do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (form.password !== form.confirm_password) {
      setError('Password and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register(form);
      navigate('/', { replace: true, state: { justRegistered: true } });
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="absolute inset-0 overflow-y-auto flex items-start justify-center px-4 py-10"
      style={{
        background: isFast
          ? 'linear-gradient(160deg, #123647, #0c2836)'
          : isMedium
            ? '#0c2836'
            : '#071620',
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="brass-plate w-full max-w-3xl rounded-2xl p-8 md:p-10 my-6"
      >
        <span className="rivet-tl" /><span className="rivet-tr" /><span className="rivet-bl" /><span className="rivet-br" />

        <div className="flex items-center gap-2 mb-5" style={{ color: 'var(--brass-bright)' }}>
          <Compass className="w-5 h-5" strokeWidth={1.5} />
          <span className="gauge-text text-[11px] tracking-wide">NCPOR EXPEDITION ATLAS · REGISTRATION</span>
        </div>

        <h1 className="text-2xl italic mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--ice)' }}>
          Join the expedition record
        </h1>
        <p className="text-sm mb-7" style={{ color: 'var(--ice-dim)' }}>
          Registration follows the same fields as the National Polar Data Center portal — your
          account is reviewed by an NCPOR administrator before you can upload or manage content.
        </p>

        {error && (
          <div className="mb-6 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* --- Personal Details ------------------------------------------------- */}
        <div className="mb-8">
          <SectionHeading icon={User}>Personal Details</SectionHeading>
          <div className="grid md:grid-cols-4 gap-4 mb-4">
            <Field label="Title">
              <select value={form.title} onChange={update('title')} className="w-full px-3 py-2 rounded text-white focus:outline-none transition-colors" style={inputStyle} {...focusHandlers}>
                <option value="">—</option>
                <option>Dr.</option><option>Mr.</option><option>Ms.</option><option>Mrs.</option><option>Prof.</option>
              </select>
            </Field>
            <div className="md:col-span-1.5">
              <Field label="First Name">
                <Input required value={form.first_name} onChange={update('first_name')} />
              </Field>
            </div>
            <Field label="Last Name">
              <Input required value={form.last_name} onChange={update('last_name')} />
            </Field>
            <Field label="Preferred Name" optional>
              <Input value={form.preferred_name} onChange={update('preferred_name')} />
            </Field>
          </div>
        </div>

        {/* --- Login Details ------------------------------------------------- */}
        <div className="mb-8">
          <SectionHeading icon={Mail}>Login Details</SectionHeading>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <Field label="Email">
              <Input type="email" required autoComplete="email" value={form.email} onChange={update('email')} />
            </Field>
            <Field label="Confirm Email">
              <Input type="email" required value={form.confirm_email} onChange={update('confirm_email')} />
            </Field>
            <Field label="Password">
              <Input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={update('password')} />
            </Field>
            <Field label="Confirm Password">
              <Input type="password" required minLength={8} autoComplete="new-password" value={form.confirm_password} onChange={update('confirm_password')} />
            </Field>
          </div>
        </div>

        {/* --- Organisation / Institution ------------------------------------ */}
        <div className="mb-8">
          <SectionHeading icon={Building2}>Organisation / Institution</SectionHeading>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <Field label="Designation">
              <Input value={form.designation} onChange={update('designation')} placeholder="e.g., Research Scientist" />
            </Field>
            <Field label="Organisation Name">
              <Input required value={form.organisation_name} onChange={update('organisation_name')} placeholder="e.g., NCPOR" />
            </Field>
          </div>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <Field label="Organisation Website" optional>
              <Input type="url" value={form.organisation_website} onChange={update('organisation_website')} placeholder="https://…" />
            </Field>
            <Field label="Personal Profile / Organisation Profile URL" optional>
              <Input type="url" value={form.personal_profile_url} onChange={update('personal_profile_url')} placeholder="https://…" />
            </Field>
          </div>
        </div>

        {/* --- Contact Details ------------------------------------------------ */}
        <div className="mb-8">
          <SectionHeading icon={Phone}>Contact Details</SectionHeading>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <Field label="Communication Address" optional>
              <Input value={form.communication_address} onChange={update('communication_address')} />
            </Field>
            <Field label="Alternate Email" optional>
              <Input type="email" value={form.alternate_email} onChange={update('alternate_email')} />
            </Field>
          </div>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <Field label="Mobile Number" optional>
              <Input type="tel" value={form.mobile_number} onChange={update('mobile_number')} />
            </Field>
            <Field label="Account Type">
              <select value={form.role} onChange={update('role')} className="w-full px-3 py-2 rounded text-white focus:outline-none transition-colors" style={inputStyle} {...focusHandlers}>
                <option value="researcher">Researcher</option>
                <option value="public">Public / General User</option>
                {/* comms_officer and admin are deliberately never offered
                    here — those roles are assigned later by an existing
                    admin, never chosen at signup (see account.controller.js). */}
              </select>
            </Field>
          </div>
        </div>

        <div className="flex items-start gap-2 mb-7 px-4 py-3 rounded-lg" style={{ background: 'rgba(111,212,201,0.06)', border: '1px solid var(--brass-dim)' }}>
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--brass-bright)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ice-dim)' }}>
            New accounts start as <span className="gauge-text" style={{ color: 'var(--brass-bright)' }}>pending</span>.
            You can sign in right away, but uploading data or submitting scientific metadata is
            unlocked once an NCPOR administrator verifies your account.
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 rounded text-[#071620] font-semibold transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
          style={{ background: 'linear-gradient(160deg, var(--brass-bright), var(--brass))' }}
        >
          {submitting ? 'Creating account…' : <>Create account <ChevronRight className="w-4 h-4" /></>}
        </button>

        <p className="text-sm mt-4 text-center" style={{ color: 'var(--ice-dim)' }}>
          Already have an account?{' '}
          <Link to="/login" className="hover:underline" style={{ color: 'var(--brass-bright)' }}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}
