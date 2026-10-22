import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../../api/notifications.js';
import { timeAgo } from './utils.js';

// Bell + dropdown. The unread count comes from the layout's occasional
// summary check; the list itself is only fetched when the bell is opened.
export default function NotificationBell({ unread, onChanged }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      try { setItems((await fetchNotifications({ limit: 8 })).notifications); } catch { setItems([]); }
    }
  }

  async function openItem(n) {
    setOpen(false);
    if (!n.readAt) { markNotificationRead(n.id).then(onChanged).catch(() => {}); }
    if (n.link) navigate(n.link);
  }

  async function readAll() {
    await markAllNotificationsRead().catch(() => {});
    setItems((list) => list?.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    onChanged?.();
  }

  return (
    <div className="relative">
      <button type="button" onClick={toggle} className="relative rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Notifications" title="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#ff4500] px-1 text-center text-[10px] font-bold leading-[18px] text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close notifications" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[360px] max-w-[92vw] overflow-hidden rounded-2xl border border-white/10 bg-[#0f2530] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <span className="font-semibold text-white">Notifications</span>
              <button type="button" onClick={readAll} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline"><CheckCheck className="h-3.5 w-3.5" /> Mark all as read</button>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {items === null && <p className="px-4 py-6 text-center text-xs text-slate-500">Loading…</p>}
              {items?.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</p>}
              {items?.map((n) => (
                <button key={n.id} type="button" onClick={() => openItem(n)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-white/5 ${n.readAt ? '' : 'bg-cyan-300/[0.05]'}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-[#ff4500]'}`} />
                  <span className="min-w-0">
                    <span className="block text-sm leading-5 text-slate-200">{n.title}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
            <Link to="/communities/notifications" onClick={() => setOpen(false)} className="block border-t border-white/5 py-2.5 text-center text-sm text-cyan-300 hover:bg-white/5">See all notifications</Link>
          </div>
        </>
      )}
    </div>
  );
}
