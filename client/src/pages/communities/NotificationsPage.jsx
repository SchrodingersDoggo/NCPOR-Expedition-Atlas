import React, { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../../api/notifications.js';
import { timeAgo } from '../../components/communities/utils.js';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { refreshSummary } = useOutletContext();
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load(before) {
    setLoading(true);
    try {
      const data = await fetchNotifications({ limit: 25, before });
      setItems((prev) => (before ? [...prev, ...data.notifications] : data.notifications));
      setHasMore(data.hasMore);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function open(n) {
    if (!n.readAt) { await markNotificationRead(n.id).catch(() => {}); refreshSummary(); }
    if (n.link) navigate(n.link);
  }

  async function readAll() {
    await markAllNotificationsRead().catch(() => {});
    setItems((list) => list.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    refreshSummary();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Notifications</h1>
        <button type="button" onClick={readAll} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-cyan-300 hover:bg-white/5"><CheckCheck className="h-4 w-4" /> Mark all as read</button>
      </div>
      <div className="mt-4 divide-y divide-white/10">
        {items.map((n) => (
          <button key={n.id} type="button" onClick={() => open(n)} className={`flex w-full gap-3 px-3 py-4 text-left hover:bg-white/[0.04] ${n.readAt ? '' : 'bg-cyan-300/[0.04]'}`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-[#ff4500]'}`} />
            <span><span className="block text-sm text-slate-200">{n.title}</span><span className="text-xs text-slate-500">{timeAgo(n.createdAt)}</span></span>
          </button>
        ))}
      </div>
      {!loading && items.length === 0 && <p className="py-16 text-center text-sm text-slate-500">No notifications yet. Replies, comments and join requests will show up here.</p>}
      {loading && <p className="py-8 text-center text-sm text-slate-500">Loading…</p>}
      {hasMore && !loading && <div className="py-6 text-center"><button type="button" onClick={() => load(items[items.length - 1].createdAt)} className="rounded-full border border-white/15 px-5 py-2 text-sm text-slate-200 hover:bg-white/5">Load more</button></div>}
    </div>
  );
}
