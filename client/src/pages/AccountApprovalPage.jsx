import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, UserCheck, UserX, UserCog, Ban, RotateCcw, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'rejected', label: 'Rejected' },
];

const STATUS_STYLE = {
  pending: 'bg-amber-900/40 text-amber-300 border-amber-700',
  active: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  suspended: 'bg-red-900/40 text-red-300 border-red-700',
  rejected: 'bg-slate-800/60 text-slate-400 border-slate-600',
};

const ROLE_OPTIONS = ['public', 'researcher', 'comms_officer', 'admin'];

async function fetchAccounts(status) {
  const { data } = await api.get('/accounts', { params: status ? { status } : undefined });
  return Array.isArray(data) ? data : [];
}
async function setAccountStatus(id, status) {
  const { data } = await api.patch(`/accounts/${id}/status`, { status });
  return data;
}
async function setAccountRole(id, role) {
  const { data } = await api.patch(`/accounts/${id}/role`, { role });
  return data;
}

function AccountCard({ account, currentUserId, isAdmin, onDecide, onRoleChange, busy }) {
  const [roleOpen, setRoleOpen] = useState(false);
  const isSelf = account.id === currentUserId;

  return (
    <div className="brass-plate rounded-lg p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <h3 className="text-base font-semibold" style={{ color: 'var(--ice)' }}>
              {account.title ? `${account.title} ` : ''}{account.name}
              {account.preferredName && <span className="font-normal opacity-70"> ({account.preferredName})</span>}
            </h3>
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${STATUS_STYLE[account.accountStatus] || ''}`}>
              {account.accountStatus}
            </span>
            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-cyan-900/40 text-cyan-300 border border-cyan-800">
              {account.role}
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--ice-dim)' }}>{account.email}</p>
          <div className="text-xs mt-2 flex gap-4 flex-wrap" style={{ color: 'var(--ice-dim)', opacity: 0.75 }}>
            {account.designation && <span>{account.designation}</span>}
            {account.organization && <span>{account.organization}</span>}
            <span>Registered {new Date(account.createdAt).toLocaleDateString()}</span>
            {account.approver && <span>Last reviewed by {account.approver.name}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {account.accountStatus === 'pending' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecide(account.id, 'active')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                <UserCheck className="w-4 h-4" /> Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecide(account.id, 'rejected')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-800 text-red-300 hover:bg-red-950/40 disabled:opacity-50 text-sm font-medium transition-colors"
              >
                <UserX className="w-4 h-4" /> Reject
              </button>
            </>
          )}
          {account.accountStatus === 'active' && !isSelf && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide(account.id, 'suspended')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-800 text-red-300 hover:bg-red-950/40 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              <Ban className="w-4 h-4" /> Suspend
            </button>
          )}
          {['suspended', 'rejected'].includes(account.accountStatus) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecide(account.id, 'active')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Reactivate
            </button>
          )}

          {/* Role assignment — admin only, and never on your own account,
              matching the backend's own enforcement of both rules. */}
          {isAdmin && !isSelf && (
            <div className="relative">
              <button
                type="button"
                disabled={busy}
                onClick={() => setRoleOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border disabled:opacity-50 text-sm font-medium transition-colors"
                style={{ borderColor: 'var(--brass-dim)', color: 'var(--ice-dim)' }}
              >
                <UserCog className="w-4 h-4" /> Role <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {roleOpen && (
                <div
                  className="absolute right-0 mt-1 w-40 rounded-lg overflow-hidden z-10 shadow-xl"
                  style={{ background: '#0f2129', border: '1px solid var(--brass-dim)' }}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { setRoleOpen(false); onRoleChange(account.id, r); }}
                      disabled={r === account.role}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40 transition-colors"
                      style={{ color: 'var(--ice-dim)' }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AccountApprovalPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState('pending');
  const [accounts, setAccounts] = useState([]);
  const [status, setStatus] = useState('loading');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setStatus('loading');
    fetchAccounts(tab)
      .then((list) => { setAccounts(list); setStatus('ready'); })
      .catch((err) => { console.error('Failed to load accounts', err); setStatus('error'); });
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const handleDecide = async (id, nextStatus) => {
    setBusyId(id);
    try {
      await setAccountStatus(id, nextStatus);
      setAccounts((list) => list.filter((a) => a.id !== id));
      toast.success(
        nextStatus === 'active' ? 'Account approved.'
          : nextStatus === 'rejected' ? 'Account rejected.'
          : nextStatus === 'suspended' ? 'Account suspended.' : 'Account updated.'
      );
    } catch (err) {
      console.error('Failed to update account status', err);
      toast.error('Could not update that account. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = async (id, role) => {
    setBusyId(id);
    try {
      const updated = await setAccountRole(id, role);
      setAccounts((list) => list.map((a) => (a.id === id ? updated : a)));
      toast.success(`Role updated to ${role}.`);
    } catch (err) {
      console.error('Failed to update role', err);
      toast.error(err.response?.data?.error || 'Could not update that role.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="chart-backdrop min-h-screen px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--brass-bright)' }}>
          <ShieldCheck className="w-4 h-4" strokeWidth={1.5} />
          <span className="gauge-text text-[11px] tracking-wide">ACCOUNT APPROVAL</span>
        </div>
        <h1 className="text-2xl italic mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--ice)' }}>
          Manage Accounts
        </h1>
        <p className="mb-6" style={{ color: 'var(--ice-dim)' }}>
          Approve or reject new registrations, suspend or reactivate existing accounts.
          {isAdmin ? ' As an admin, you can also assign roles.' : ' Role assignment is admin-only.'}
        </p>

        <div className="flex gap-1 mb-7 p-1 rounded-lg w-fit" style={{ background: 'rgba(7,22,32,0.5)', border: '1px solid var(--brass-dim)' }}>
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className="px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors"
              style={tab === t.value
                ? { background: 'var(--brass)', color: '#071620' }
                : { color: 'var(--ice-dim)' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {status === 'loading' && <p style={{ color: 'var(--ice-dim)' }}>Loading…</p>}
        {status === 'error' && (
          <p className="text-red-400">Couldn't load accounts. Try refreshing.</p>
        )}
        {status === 'ready' && accounts.length === 0 && (
          <p style={{ color: 'var(--ice-dim)' }}>No {tab} accounts right now.</p>
        )}
        {status === 'ready' &&
          accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              currentUserId={user?.id}
              isAdmin={isAdmin}
              busy={busyId === account.id}
              onDecide={handleDecide}
              onRoleChange={handleRoleChange}
            />
          ))}
      </div>
    </div>
  );
}
