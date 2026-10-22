import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, LogOut, Pencil, X, Loader2, Compass, Upload, FileCheck2, CalendarClock } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchMyProfile, updateMyProfile, uploadMyAvatar } from '../api/users.js';

const ROLE_LABELS = {
  admin: 'Admin',
  comms_officer: 'Comms Officer',
  researcher: 'Researcher',
  public: 'Public',
};

function initialsFor(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const EMPTY_CONTACT = {
  bio: '', linkedinUrl: '', researchGateUrl: '', orcidId: '', twitterUrl: '', githubUrl: '', personalProfileUrl: '',
  showEmail: false, showMobile: false,
};

const CONTACT_FIELDS = [
  ['linkedinUrl', 'LinkedIn', 'https://www.linkedin.com/in/your-name'],
  ['researchGateUrl', 'ResearchGate', 'https://www.researchgate.net/profile/Your-Name'],
  ['orcidId', 'ORCID iD', '0000-0002-1825-0097'],
  ['twitterUrl', 'X / Twitter', 'https://x.com/yourhandle'],
  ['githubUrl', 'GitHub', 'https://github.com/yourname'],
  ['personalProfileUrl', 'Website', 'https://your-site.org'],
];

function contactFrom(data) {
  const out = { ...EMPTY_CONTACT };
  for (const key of Object.keys(EMPTY_CONTACT)) {
    if (typeof EMPTY_CONTACT[key] === 'boolean') out[key] = Boolean(data[key]);
    else out[key] = data[key] || '';
  }
  return out;
}

export default function ProfilePage() {
  const { logout, updateStoredUser } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', organization: '' });
  // Communities update — public contact links shown on your researcher /
  // community profile so other researchers can connect with you.
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [contactEditing, setContactEditing] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState('');
  const [saving, setSaving] = useState(false);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchMyProfile()
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setForm({ name: data.name, organization: data.organization });
        setContact(contactFrom(data));
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Could not load your profile.');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await updateMyProfile(form);
      setProfile((prev) => ({ ...prev, ...updated }));
      updateStoredUser({ name: updated.name, organization: updated.organization });
      setEditing(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your changes.');
    } finally {
      setSaving(false);
    }
  }

  async function handleContactSave(e) {
    e.preventDefault();
    setContactSaving(true);
    setContactError('');
    try {
      const updated = await updateMyProfile({ name: profile.name, organization: profile.organization, ...contact });
      setProfile((prev) => ({ ...prev, ...updated }));
      setContact(contactFrom(updated));
      setContactEditing(false);
    } catch (err) {
      setContactError(err.response?.data?.error || 'Could not save your contact links.');
    } finally {
      setContactSaving(false);
    }
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setAvatarUploading(true);
    setAvatarError('');
    try {
      const updated = await uploadMyAvatar(file);
      setProfile((prev) => ({ ...prev, avatarUrl: updated.avatarUrl }));
      updateStoredUser({ avatarUrl: updated.avatarUrl });
    } catch (err) {
      setAvatarError(err.response?.data?.error || 'Avatar upload failed.');
    } finally {
      setAvatarUploading(false);
    }
  }

  function handleLogout() {
    logout();
    navigate('/');
  }

  if (status === 'loading') {
    return (
      <div className="chart-backdrop absolute inset-0 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--brass-bright)' }} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="chart-backdrop absolute inset-0 flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const stats = profile.stats || {};

  return (
    <div className="chart-backdrop absolute inset-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--brass-bright)' }}>
          <Compass className="w-4 h-4" strokeWidth={1.5} />
          <span className="gauge-text text-[11px] tracking-wide">YOUR RECORD</span>
        </div>
        <h1 className="text-2xl italic mb-6" style={{ fontFamily: 'var(--font-display)', color: 'var(--ice)' }}>
          Profile
        </h1>

        {/* Identity card */}
        <div className="brass-plate rounded-xl p-6 flex items-center gap-5">
          <div className="relative shrink-0">
            <div
              className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-xl font-semibold"
              style={{ background: 'rgba(7,22,32,0.6)', border: '1px solid var(--brass-dim)', color: 'var(--brass-bright)' }}
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.name} className="w-full h-full object-cover" />
              ) : (
                initialsFor(profile.name)
              )}
            </div>

            {/* Upload option — sits on the avatar itself, like a typical profile photo picker */}
            <label
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer border-2 transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(160deg, var(--brass-bright), var(--brass))', borderColor: 'var(--hull)' }}
              title="Upload a new photo"
            >
              {avatarUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#071620' }} />
              ) : (
                <Camera className="w-3.5 h-3.5" style={{ color: '#071620' }} />
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatarChange}
                disabled={avatarUploading}
              />
            </label>
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold truncate" style={{ color: 'var(--ice)' }}>{profile.name}</div>
            <div className="text-sm truncate" style={{ color: 'var(--ice-dim)' }}>{profile.email}</div>
            <div className="flex items-center gap-2 mt-2">
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(232,198,136,0.1)', border: '1px solid var(--brass-dim)', color: 'var(--brass-bright)' }}
              >
                {ROLE_LABELS[profile.role] || profile.role}
              </span>
              <span className="text-xs" style={{ color: 'var(--ice-dim)' }}>{profile.organization}</span>
            </div>
          </div>
        </div>

        {avatarError && (
          <p className="mt-2 text-xs text-red-300">{avatarError}</p>
        )}

        {/* Profile details / edit form */}
        <div className="brass-plate rounded-xl p-6 mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium" style={{ color: 'var(--ice-dim)' }}>Profile details</h2>
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 text-xs hover:underline"
                style={{ color: 'var(--brass-bright)' }}
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>

          {error && editing && (
            <div className="mb-4 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          {editing ? (
            <form onSubmit={handleSave}>
              <label className="block text-sm mb-1" style={{ color: 'var(--ice-dim)' }}>Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full mb-4 px-3 py-2 rounded text-white focus:outline-none transition-colors"
                style={{ background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--brass-bright)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--brass-dim)')}
              />

              <label className="block text-sm mb-1" style={{ color: 'var(--ice-dim)' }}>Organization</label>
              <input
                type="text"
                required
                value={form.organization}
                onChange={(e) => setForm((f) => ({ ...f, organization: e.target.value }))}
                className="w-full mb-6 px-3 py-2 rounded text-white focus:outline-none transition-colors"
                style={{ background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--brass-bright)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--brass-dim)')}
              />

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded text-[#071620] text-sm font-semibold transition-opacity disabled:opacity-50"
                  style={{ background: 'linear-gradient(160deg, var(--brass-bright), var(--brass))' }}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setError('');
                    setForm({ name: profile.name, organization: profile.organization });
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm transition-colors hover:text-white"
                  style={{ border: '1px solid var(--brass-dim)', color: 'var(--ice-dim)' }}
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </form>
          ) : (
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt style={{ color: 'var(--ice-dim)' }}>Email</dt>
                <dd style={{ color: 'var(--ice)' }}>{profile.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt style={{ color: 'var(--ice-dim)' }}>Organization</dt>
                <dd style={{ color: 'var(--ice)' }}>{profile.organization}</dd>
              </div>
              <div className="flex justify-between">
                <dt style={{ color: 'var(--ice-dim)' }}>Role</dt>
                <dd style={{ color: 'var(--ice)' }}>{ROLE_LABELS[profile.role] || profile.role}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="inline-flex items-center gap-1.5" style={{ color: 'var(--ice-dim)' }}>
                  <CalendarClock className="w-3.5 h-3.5" /> Member since
                </dt>
                <dd style={{ color: 'var(--ice)' }}>
                  {new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
                </dd>
              </div>
            </dl>
          )}
        </div>

        {/* Contact & social links (Communities update) */}
        <div className="brass-plate rounded-xl p-6 mt-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-medium" style={{ color: 'var(--ice-dim)' }}>Contact &amp; social links</h2>
            {!contactEditing && (
              <button type="button" onClick={() => setContactEditing(true)} className="inline-flex items-center gap-1.5 text-xs hover:underline" style={{ color: 'var(--brass-bright)' }}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>
          <p className="text-xs mb-4" style={{ color: 'var(--ice-dim)' }}>Shown on your researcher and community profile so others can connect with you. Everyone can always send you a direct message.</p>

          {contactEditing ? (
            <form onSubmit={handleContactSave} className="space-y-3">
              {contactError && <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{contactError}</div>}
              <label className="block text-sm" style={{ color: 'var(--ice-dim)' }}>Short bio
                <textarea
                  value={contact.bio}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setContact((c) => ({ ...c, bio: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded text-white focus:outline-none resize-none"
                  style={{ background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' }}
                  placeholder="Glaciologist working on Himalayan mass balance…"
                />
              </label>
              {CONTACT_FIELDS.map(([key, label, placeholder]) => (
                <label key={key} className="block text-sm" style={{ color: 'var(--ice-dim)' }}>{label}
                  <input
                    type={key === 'orcidId' ? 'text' : 'url'}
                    value={contact[key]}
                    onChange={(e) => setContact((c) => ({ ...c, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="mt-1 w-full px-3 py-2 rounded text-white focus:outline-none"
                    style={{ background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' }}
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ice)' }}>
                <input type="checkbox" checked={contact.showEmail} onChange={(e) => setContact((c) => ({ ...c, showEmail: e.target.checked }))} />
                Show my email address on my public profile
              </label>
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ice)' }}>
                <input type="checkbox" checked={contact.showMobile} onChange={(e) => setContact((c) => ({ ...c, showMobile: e.target.checked }))} />
                Show my mobile number on my public profile {profile.mobileNumber ? '' : '(none on file)'}
              </label>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={contactSaving} className="px-4 py-2 rounded text-[#071620] text-sm font-semibold disabled:opacity-50" style={{ background: 'linear-gradient(160deg, var(--brass-bright), var(--brass))' }}>
                  {contactSaving ? 'Saving…' : 'Save links'}
                </button>
                <button type="button" onClick={() => { setContactEditing(false); setContactError(''); setContact(contactFrom(profile)); }} className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-sm hover:text-white" style={{ border: '1px solid var(--brass-dim)', color: 'var(--ice-dim)' }}>
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            </form>
          ) : (
            <dl className="space-y-2 text-sm">
              {CONTACT_FIELDS.filter(([key]) => profile[key]).map(([key, label]) => (
                <div key={key} className="flex justify-between gap-4">
                  <dt style={{ color: 'var(--ice-dim)' }}>{label}</dt>
                  <dd className="truncate" style={{ color: 'var(--ice)' }}>{profile[key]}</dd>
                </div>
              ))}
              {!CONTACT_FIELDS.some(([key]) => profile[key]) && <p className="text-xs" style={{ color: 'var(--ice-dim)' }}>No links added yet.</p>}
              <div className="flex justify-between gap-4 pt-1">
                <dt style={{ color: 'var(--ice-dim)' }}>Email on profile</dt>
                <dd style={{ color: 'var(--ice)' }}>{profile.showEmail ? 'Visible' : 'Hidden'}</dd>
              </div>
            </dl>
          )}
        </div>

        {/* Contribution stats — pulled from the same relations the rest of
            the portal already tracks (expeditions led, content uploaded/
            approved, activities created). */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'Expeditions led', value: stats.expeditionsLed, icon: Compass },
            { label: 'Content uploaded', value: stats.contentUploaded, icon: Upload },
            { label: 'Content approved', value: stats.contentApproved, icon: FileCheck2 },
            { label: 'Activities created', value: stats.activitiesCreated, icon: CalendarClock },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="brass-plate rounded-xl p-4">
              <Icon className="w-4 h-4 mb-2" style={{ color: 'var(--brass-bright)' }} />
              <div className="text-xl font-semibold gauge-text" style={{ color: 'var(--ice)' }}>{value ?? 0}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--ice-dim)' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 text-sm font-medium transition-colors"
        >
          <LogOut className="w-4 h-4" /> Log out
        </button>
      </div>
    </div>
  );
}
