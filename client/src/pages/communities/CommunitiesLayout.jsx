import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown, Compass, House, Menu, MessageSquare, Newspaper, Plus, Settings, Star, TrendingUp, WifiOff, X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNetwork } from '../../context/NetworkContext.jsx';
import { fetchMyCommunities } from '../../api/communities.js';
import { fetchNotificationSummary } from '../../api/notifications.js';
import SearchBar from '../../components/communities/SearchBar.jsx';
import NotificationBell from '../../components/communities/NotificationBell.jsx';
import CommunityIcon from '../../components/communities/CommunityIcon.jsx';
import CreateCommunityModal from '../../components/communities/CreateCommunityModal.jsx';
import MessagesPage from '../MessagesPage.jsx';
import { clearRecentCommunities, getRecentCommunities } from '../../components/communities/utils.js';

// The unread-count check is deliberately slow and scoped to this layout:
// it only runs while a Communities page is open, never app-wide.
const SUMMARY_INTERVAL = { normal: 60_000, slow: 180_000 };

function SideLink({ to, icon: Icon, children, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm ${isActive ? 'bg-white/10 font-semibold text-white' : 'text-slate-300 hover:bg-white/5'}`}
    >
      <Icon className="h-5 w-5" /> {children}
    </NavLink>
  );
}

function Section({ title, children, action }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-white/10 py-3">
      <div className="flex items-center justify-between px-4">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center justify-between py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300">
          {title}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        {action}
      </div>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

export default function CommunitiesLayout() {
  const { user, isAuthenticated } = useAuth();
  const { isSlow, isOffline } = useNetwork();
  const navigate = useNavigate();
  const location = useLocation();

  const [mine, setMine] = useState([]);
  const [recent, setRecent] = useState(getRecentCommunities);
  const [summary, setSummary] = useState({ notifications: 0, messages: 0 });
  const [creating, setCreating] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);

  const refreshMine = useCallback(async () => {
    if (!isAuthenticated) { setMine([]); return; }
    try { setMine(await fetchMyCommunities()); } catch { /* sidebar is non-critical */ }
  }, [isAuthenticated]);

  const refreshSummary = useCallback(async () => {
    if (!isAuthenticated) return;
    try { setSummary(await fetchNotificationSummary()); } catch { /* ignore */ }
  }, [isAuthenticated]);

  useEffect(() => { refreshMine(); }, [refreshMine]);

  // Occasional unread check while this layout is mounted. Stops offline,
  // slows down on low bandwidth, and is cleaned up on unmount.
  useEffect(() => {
    if (!isAuthenticated || isOffline) return undefined;
    refreshSummary();
    const id = setInterval(refreshSummary, isSlow ? SUMMARY_INTERVAL.slow : SUMMARY_INTERVAL.normal);
    return () => clearInterval(id);
  }, [isAuthenticated, isOffline, isSlow, refreshSummary]);

  useEffect(() => {
    const sync = () => setRecent(getRecentCommunities());
    window.addEventListener('ncpor:recent-communities', sync);
    return () => window.removeEventListener('ncpor:recent-communities', sync);
  }, []);

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  const currentSlug = location.pathname.match(/^\/communities\/c\/([^/]+)/)?.[1];
  const canCreateCommunity = isAuthenticated && ['researcher', 'comms_officer', 'admin'].includes(user?.role);
  const active = mine.filter((c) => c.membership?.status === 'active');
  const favorites = active.filter((c) => c.membership?.favorite);
  const others = active.filter((c) => !c.membership?.favorite);

  function requireLogin(path) {
    if (!isAuthenticated) { navigate('/login', { state: { from: { pathname: path || location.pathname } } }); return false; }
    return true;
  }

  function openCreatePost() {
    const path = currentSlug ? `/communities/submit?community=${currentSlug}` : '/communities/submit';
    if (requireLogin(path)) navigate(path);
  }

  const sidebar = (
    <nav className="flex h-full flex-col overflow-y-auto px-2 py-3">
      <SideLink to="/communities" end icon={House}>Home</SideLink>
      <SideLink to="/communities/popular" icon={TrendingUp}>Popular</SideLink>
      <SideLink to="/communities/news" icon={Newspaper}>News</SideLink>
      <SideLink to="/communities/explore" icon={Compass}>Explore</SideLink>

      {canCreateCommunity && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5">
            <Plus className="h-5 w-5" /> Start a community
          </button>
        </div>
      )}

      {recent.length > 0 && (
        <Section title="Recent" action={<button type="button" onClick={clearRecentCommunities} className="ml-2 text-[10px] text-slate-500 hover:text-slate-300">Clear</button>}>
          {recent.map((c) => (
            <Link key={c.slug} to={`/communities/c/${c.slug}`} className="flex items-center gap-3 rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
              <CommunityIcon community={c} size={26} /> c/{c.slug}
            </Link>
          ))}
        </Section>
      )}

      {isAuthenticated && (
        <Section title="Communities">
          <SideLink to="/communities/manage" icon={Settings}>Manage Communities</SideLink>
          {[...favorites, ...others].map((c) => (
            <Link key={c.id} to={`/communities/c/${c.slug}`} className={`flex items-center gap-3 rounded-xl px-4 py-2 text-sm hover:bg-white/5 ${currentSlug === c.slug ? 'bg-white/10 text-white' : 'text-slate-300'}`}>
              <CommunityIcon community={c} size={26} />
              <span className="flex-1 truncate">c/{c.slug}</span>
              {c.membership?.favorite && <Star className="h-3.5 w-3.5 text-[#ffb000]" fill="currentColor" />}
            </Link>
          ))}
          {active.length === 0 && <p className="px-4 py-2 text-xs text-slate-500">Join communities from Explore to see them here.</p>}
        </Section>
      )}
    </nav>
  );

  return (
    <div className="min-h-full bg-[#081820] text-slate-200">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 bg-[#0a1c24]/95 px-3 backdrop-blur md:px-5">
        <button type="button" onClick={() => setDrawer(true)} className="rounded-full p-2 hover:bg-white/10 lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <Link to="/communities" className="hidden shrink-0 items-center gap-2 sm:flex">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ff4500] text-sm font-black text-white">c/</span>
          <span className="text-lg font-bold text-white">communities</span>
        </Link>
        <div className="flex flex-1 justify-center"><SearchBar /></div>
        <div className="flex items-center gap-1">
          {isAuthenticated && (
            <button type="button" onClick={() => setMessagesOpen(true)} className="relative rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Messages" title="Messages">
              <MessageSquare className="h-5 w-5" />
              {summary.messages > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#ff4500] px-1 text-center text-[10px] font-bold leading-[18px] text-white">{summary.messages > 99 ? '99+' : summary.messages}</span>}
            </button>
          )}
          <button type="button" onClick={openCreatePost} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">
            <Plus className="h-5 w-5" /> <span className="hidden sm:inline">Create</span>
          </button>
          {isAuthenticated ? (
            <NotificationBell unread={summary.notifications} onChanged={refreshSummary} />
          ) : (
            <Link to="/login" state={{ from: location }} className="ml-1 rounded-full bg-[#ff4500] px-4 py-2 text-sm font-bold text-white hover:bg-[#ff5719]">Log In</Link>
          )}
        </div>
      </header>

      {isOffline && (
        <div className="flex items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
          <WifiOff className="h-3.5 w-3.5" /> You're offline — showing what's already loaded. Posting and voting resume when you reconnect.
        </div>
      )}

      <div className="mx-auto flex max-w-[1400px]">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[270px] shrink-0 border-r border-white/10 lg:block">{sidebar}</aside>
        <main className="min-w-0 flex-1 px-3 py-4 md:px-6">
          <Outlet context={{ user, mine, refreshMine, refreshSummary, canCreateCommunity, openCreateCommunity: () => canCreateCommunity && setCreating(true) }} />
        </main>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 h-full w-[280px] border-r border-white/10 bg-[#0a1c24]">
            <div className="flex justify-end p-2"><button type="button" onClick={() => setDrawer(false)} className="rounded-full p-2 hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button></div>
            {sidebar}
          </div>
        </div>
      )}

      {messagesOpen && (
        <div className="fixed inset-0 z-[105] bg-black/45 p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && setMessagesOpen(false)}>
          <div className="relative ml-auto h-full w-full max-w-[920px] overflow-hidden rounded-2xl border border-white/10 bg-[#061820] shadow-2xl">
            <button type="button" onClick={() => { setMessagesOpen(false); refreshSummary(); }} className="absolute right-2 top-2 z-[3] rounded-full bg-[#0c222b]/90 p-2 text-slate-300 shadow hover:bg-white/10 hover:text-white" aria-label="Close messages" title="Close messages">
              <X className="h-4 w-4" />
            </button>
            <MessagesPage embedded />
          </div>
        </div>
      )}

      {creating && (
        <CreateCommunityModal
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); refreshMine(); navigate(`/communities/c/${c.slug}`); }}
        />
      )}
    </div>
  );
}
