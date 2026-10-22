import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Search, Send, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useNetwork } from '../context/NetworkContext.jsx';
import {
  fetchConversation, fetchConversations, fetchNewMessages, fetchOlderMessages, markConversationRead, sendMessage,
} from '../api/messages.js';
import Avatar from '../components/communities/Avatar.jsx';

// ---------------------------------------------------------------------------
// Direct messages — REST + polling, no WebSockets.
//
// Polling lives ONLY in this component. It starts when the page mounts and
// the cleanup function clears the timer when you leave, so nothing polls
// app-wide. The interval follows the portal's existing NetworkContext:
//   normal connection → every 5 s
//   low bandwidth     → every 30 s
//   offline           → no polling at all (resumes automatically when the
//                        connection comes back, because isOffline changes)
//
// Each tick makes ONE small request: the inbox "since" the last poll. That
// usually returns an empty list. Only when it shows activity in the open
// conversation do we ask for messages ?after=<last id> — never the whole
// history again.
// ---------------------------------------------------------------------------

const POLL_NORMAL_MS = 5_000;
const POLL_LOW_BANDWIDTH_MS = 30_000;
const SINCE_OVERLAP_MS = 10_000; // re-check a small window so no message slips between polls
const MAX_LENGTH = 2000;

function mergeById(list, incoming) {
  const seen = new Set(list.map((m) => m.id));
  return [...list, ...incoming.filter((m) => !seen.has(m.id))];
}

function sortConversations(list) {
  return [...list].sort((a, b) => new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0));
}

function shortTime(value) {
  const d = new Date(value);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const diffDays = (today - d) / 86_400_000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function dayLabel(value) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function MessagesPage({ embedded = false }) {
  const { user } = useAuth();
  const { isSlow, isOffline } = useNetwork();
  const [params, setParams] = useSearchParams();

  const [conversations, setConversations] = useState([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [activeId, setActiveId] = useState(params.get('to') || null);
  const [thread, setThread] = useState(null); // { user, messages, hasMore }
  const [threadError, setThreadError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);

  const sinceRef = useRef(null);
  const activeRef = useRef(activeId);
  const lastIdRef = useRef(null);
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const preserveScrollRef = useRef(null);
  const pollingRef = useRef(false);

  activeRef.current = activeId;

  // ---- initial inbox --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    fetchConversations()
      .then((data) => {
        if (cancelled) return;
        setConversations(sortConversations(data.conversations));
        sinceRef.current = data.serverTime;
      })
      .catch(() => {})
      .finally(() => !cancelled && setInboxLoading(false));
    return () => { cancelled = true; };
  }, []);

  // ---- open a conversation --------------------------------------------------
  const openConversation = useCallback(async (userId) => {
    setActiveId(userId);
    setThread(null);
    setThreadError('');
    setSendError('');
    lastIdRef.current = null;
    stickToBottomRef.current = true;
    setParams(userId ? { to: userId } : {}, { replace: true });
    if (!userId) return;
    try {
      const data = await fetchConversation(userId);
      if (activeRef.current !== userId) return;
      setThread(data);
      lastIdRef.current = data.messages[data.messages.length - 1]?.id || null;
      setConversations((list) => list.map((c) => (c.user.id === userId ? { ...c, unreadCount: 0 } : c)));
      if (data.messages.some((m) => m.senderId === userId && !m.readAt)) markConversationRead(userId).catch(() => {});
    } catch (err) {
      if (activeRef.current === userId) setThreadError(err.response?.data?.error || 'Could not open this conversation.');
    }
  }, [setParams]);

  useEffect(() => {
    if (activeId) openConversation(activeId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- one polling tick -----------------------------------------------------
  const tick = useCallback(async () => {
    if (pollingRef.current || document.hidden) return; // never overlap; skip hidden tabs
    pollingRef.current = true;
    try {
      const since = sinceRef.current
        ? new Date(new Date(sinceRef.current).getTime() - SINCE_OVERLAP_MS).toISOString()
        : undefined;
      const data = await fetchConversations(since);
      sinceRef.current = data.serverTime;

      const active = activeRef.current;
      let activeChanged = false;
      if (data.conversations.length) {
        setConversations((list) => {
          const byId = new Map(list.map((c) => [c.user.id, c]));
          for (const c of data.conversations) {
            byId.set(c.user.id, c.user.id === active ? { ...c, unreadCount: 0 } : c);
          }
          return sortConversations([...byId.values()]);
        });
        activeChanged = data.conversations.some((c) => c.user.id === active);
      }

      // Only fetch the open thread when the inbox says something happened in it.
      if (active && activeChanged) {
        if (lastIdRef.current) {
          const fresh = await fetchNewMessages(active, lastIdRef.current);
          if (fresh.length && activeRef.current === active) {
            setThread((t) => (t ? { ...t, messages: mergeById(t.messages, fresh) } : t));
            lastIdRef.current = fresh[fresh.length - 1].id;
            if (fresh.some((m) => m.senderId === active)) markConversationRead(active).catch(() => {});
          }
        } else {
          // Conversation was empty when opened — load its first page.
          const full = await fetchConversation(active);
          if (activeRef.current === active) {
            setThread(full);
            lastIdRef.current = full.messages[full.messages.length - 1]?.id || null;
            markConversationRead(active).catch(() => {});
          }
        }
      }
    } catch {
      // A failed poll is simply retried on the next tick.
    } finally {
      pollingRef.current = false;
    }
  }, []);

  // ---- the polling timer (page-scoped) --------------------------------------
  useEffect(() => {
    if (isOffline) return undefined; // offline: no polling at all
    const interval = isSlow ? POLL_LOW_BANDWIDTH_MS : POLL_NORMAL_MS;
    tick(); // catch up immediately (e.g. right after reconnecting)
    const id = setInterval(tick, interval);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id); // leaving the page (or changing speed) stops this timer
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isOffline, isSlow, tick]);

  // ---- scrolling ------------------------------------------------------------
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (preserveScrollRef.current) {
      const { height, top } = preserveScrollRef.current;
      el.scrollTop = el.scrollHeight - height + top;
      preserveScrollRef.current = null;
    } else if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [thread?.messages]);

  async function onScroll() {
    const el = scrollRef.current;
    if (!el || !thread) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && thread.hasMore && !loadingOlder && !isOffline && thread.messages.length) {
      setLoadingOlder(true);
      const active = activeId;
      try {
        const older = await fetchOlderMessages(active, thread.messages[0].id);
        if (activeRef.current !== active) return;
        preserveScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
        setThread((t) => ({ ...t, messages: [...older.messages.filter((m) => !t.messages.some((x) => x.id === m.id)), ...t.messages], hasMore: older.hasMore }));
      } catch { /* try again on next scroll */ } finally {
        setLoadingOlder(false);
      }
    }
  }

  // ---- sending --------------------------------------------------------------
  async function send(e) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending || isOffline || !activeId) return;
    setSending(true);
    setSendError('');
    try {
      const message = await sendMessage(activeId, body);
      setDraft('');
      stickToBottomRef.current = true;
      setThread((t) => (t ? { ...t, messages: mergeById(t.messages, [message]) } : t));
      lastIdRef.current = message.id;
      setConversations((list) => {
        const existing = list.find((c) => c.user.id === activeId);
        const entry = {
          user: existing?.user || thread?.user,
          lastMessage: { id: message.id, preview: body.length > 90 ? `${body.slice(0, 90)}…` : body, fromMe: true, createdAt: message.createdAt },
          unreadCount: 0,
        };
        return sortConversations([entry, ...list.filter((c) => c.user.id !== activeId)]);
      });
    } catch (err) {
      setSendError(err.response?.data?.error || 'Message not sent. Please try again.');
    } finally {
      setSending(false);
    }
  }

  const visibleConversations = conversations.filter((c) => c.user?.name?.toLowerCase().includes(filter.toLowerCase()));
  const totalUnread = conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
  const activeUser = thread?.user || conversations.find((c) => c.user.id === activeId)?.user;

  return (
    <div className={`${embedded ? 'h-full' : 'absolute inset-0'} flex bg-[#061820] text-slate-200`}>
      {/* Inbox */}
      <aside className={`${activeId ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-white/10 md:w-[320px]`}>
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-white">Messages {totalUnread > 0 && <span className="ml-1 rounded-full bg-cyan-300 px-2 py-0.5 text-xs font-bold text-[#06202a]">{totalUnread}</span>}</h1>
            <span className={`inline-flex items-center gap-1 text-[11px] ${isOffline ? 'text-amber-300' : 'text-slate-500'}`}>
              {isOffline ? <><WifiOff className="h-3 w-3" /> Offline</> : isSlow ? 'Low bandwidth · checks every 30s' : ''}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3">
            <Search className="h-4 w-4 text-slate-500" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search conversations" className="w-full bg-transparent py-2 text-sm text-white outline-none placeholder:text-slate-600" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {inboxLoading && <p className="px-4 py-6 text-sm text-slate-500">Loading conversations…</p>}
          {!inboxLoading && conversations.length === 0 && !activeId && (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 text-slate-600" />
              No conversations yet. Open a researcher's profile and choose <span className="text-slate-300">Message</span> to start one.
            </div>
          )}
          {activeId && thread?.user && !conversations.some((c) => c.user.id === activeId) && (
            <div className="flex w-full items-center gap-3 border-l-2 border-cyan-300 bg-white/[0.05] px-4 py-3">
              <Avatar user={thread.user} size={40} />
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{thread.user.name}</p><p className="text-xs text-slate-500">New conversation</p></div>
            </div>
          )}
          {visibleConversations.map((c) => (
            <button
              key={c.user.id}
              type="button"
              onClick={() => openConversation(c.user.id)}
              className={`flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left ${c.user.id === activeId ? 'border-cyan-300 bg-white/[0.05]' : 'border-transparent hover:bg-white/[0.03]'}`}
            >
              <Avatar user={c.user} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`truncate text-sm ${c.unreadCount ? 'font-bold text-white' : 'font-medium text-slate-200'}`}>{c.user.name}</p>
                  <span className="shrink-0 text-[11px] text-slate-500">{shortTime(c.lastMessage.createdAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-xs ${c.unreadCount ? 'text-slate-200' : 'text-slate-500'}`}>{c.lastMessage.fromMe ? 'You: ' : ''}{c.lastMessage.preview}</p>
                  {c.unreadCount > 0 && <span className="shrink-0 rounded-full bg-cyan-300 px-1.5 text-[10px] font-bold leading-4 text-[#06202a]">{c.unreadCount}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Thread */}
      <section className={`${activeId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Select a conversation to start messaging.</div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <button type="button" onClick={() => openConversation(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 md:hidden" aria-label="Back to inbox"><ArrowLeft className="h-5 w-5" /></button>
              {activeUser && <Avatar user={activeUser} size={36} />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{activeUser?.name || 'Loading…'}</p>
                {activeUser?.organization && <p className="truncate text-xs text-slate-500">{activeUser.organization}</p>}
              </div>
              {activeUser && <Link to={`/communities/u/${activeUser.id}`} className="text-xs text-cyan-300 hover:underline">View profile</Link>}
            </header>

            <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4">
              {threadError && <p className="text-center text-sm text-red-300">{threadError}</p>}
              {!thread && !threadError && <p className="text-center text-sm text-slate-500">Loading messages…</p>}
              {thread?.hasMore && <p className="pb-3 text-center text-xs text-slate-500">{loadingOlder ? 'Loading older messages…' : 'Scroll up for older messages'}</p>}
              {thread && thread.messages.length === 0 && (
                <p className="mt-10 text-center text-sm text-slate-500">This is the start of your conversation with {thread.user.name}.</p>
              )}
              {thread?.messages.map((m, i) => {
                const mine = m.senderId === user?.id;
                const prev = thread.messages[i - 1];
                const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                return (
                  <React.Fragment key={m.id}>
                    {newDay && <div className="my-4 text-center text-[11px] uppercase tracking-wider text-slate-500">{dayLabel(m.createdAt)}</div>}
                    <div className={`mb-1.5 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-6 ${mine ? 'rounded-br-md bg-cyan-300 text-[#06202a]' : 'rounded-bl-md bg-white/[0.08] text-slate-100'}`}>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-[#06202a]/60' : 'text-slate-500'}`}>
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            <form onSubmit={send} className="border-t border-white/10 px-4 py-3">
              {isOffline && <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-300"><WifiOff className="h-3.5 w-3.5" /> You're offline. Sending is unavailable until you reconnect.</p>}
              {sendError && <p className="mb-2 text-xs text-red-300">{sendError}</p>}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
                  disabled={isOffline || !thread}
                  rows={1}
                  placeholder={isOffline ? 'Offline' : 'Write a message…'}
                  className="max-h-40 min-h-[42px] flex-1 resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button type="submit" disabled={!draft.trim() || sending || isOffline || !thread} className="inline-flex h-[42px] items-center gap-1.5 rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-[#06202a] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">
                  <Send className="h-4 w-4" /> Send
                </button>
              </div>
              {draft.length > MAX_LENGTH - 200 && <p className="mt-1 text-right text-[11px] text-slate-500">{draft.length}/{MAX_LENGTH}</p>}
            </form>
          </>
        )}
      </section>
    </div>
  );
}
