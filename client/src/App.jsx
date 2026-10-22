import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import {
  Search, Cloud, CloudOff, KeyRound, RefreshCw,
  User, Upload, LogOut, ChevronDown, HardDriveDownload, Clapperboard,
} from 'lucide-react';
import LandingPage from './pages/LandingPage';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import RouteErrorBoundary from './components/RouteErrorBoundary.jsx';
import NetworkModeToggle from './components/NetworkModeToggle.jsx';
import ExplorerSearch from './components/explorer/ExplorerSearch.jsx';
import { initSyncManager } from './offline/syncManager.js';
import { SYNC_BLOCK } from './offline/constants.js';
import { useSyncStatus } from './hooks/useSyncStatus.js';
import { NetworkProvider, useNetwork } from './context/NetworkContext.jsx';
import { useAlertNotifications } from './hooks/useAlertNotifications.jsx';
import ncporLogo from './assets/ncpor-logo.png';

// Phase 6 — progressive loading at the route level. LandingPage is the
// initial route, so it stays a normal top-level import: it's the app shell's
// own content and must be there on first paint. Every other route is code
// that a given visit may never touch, so each is its own lazy-loaded chunk
// instead of bundled into what "/" has to download before it can render.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueuePage'));
const ExpeditionPage = lazy(() => import('./pages/ExpeditionPage.jsx'));
const VizPage = lazy(() => import('./pages/VizPage.jsx'));
const SyncCenter = lazy(() => import('./components/SyncCenter.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const ArchivePage = lazy(() => import('./pages/ArchivePage.jsx'));
const ArchiveItemPage = lazy(() => import('./pages/ArchiveItemPage.jsx'));
const ExplorerPage = lazy(() => import('./pages/ExplorerPage.jsx'));
const SavedOfflinePage = lazy(() => import('./pages/SavedOfflinePage.jsx'));
const StudioPage = lazy(() => import('./pages/StudioPage.jsx'));
const AccountApprovalPage = lazy(() => import('./pages/AccountApprovalPage.jsx'));
const ActivitiesPage = lazy(() => import('./pages/ActivitiesPage.jsx'));
const ObservationPage = lazy(() => import('./pages/ObservationPage.jsx'));
const InstitutionalActivitiesPage = lazy(() => import('./pages/InstitutionalActivitiesPage.jsx'));
// Communities (Reddit-style) + Direct Messages
const CommunitiesLayout = lazy(() => import('./pages/communities/CommunitiesLayout.jsx'));
const CommunityFeedPage = lazy(() => import('./pages/communities/FeedPage.jsx'));
const CommunityPage = lazy(() => import('./pages/communities/CommunityPage.jsx'));
const CommunityExplorePage = lazy(() => import('./pages/communities/ExplorePage.jsx'));
const CreatePostPage = lazy(() => import('./pages/communities/CreatePostPage.jsx'));
const PostDetailPage = lazy(() => import('./pages/communities/PostDetailPage.jsx'));
const ManageCommunitiesPage = lazy(() => import('./pages/communities/ManageCommunitiesPage.jsx'));
const ModToolsPage = lazy(() => import('./pages/communities/ModToolsPage.jsx'));
const CommunitySearchPage = lazy(() => import('./pages/communities/SearchResultsPage.jsx'));
const CommunityUserPage = lazy(() => import('./pages/communities/UserProfilePage.jsx'));
const NotificationsPage = lazy(() => import('./pages/communities/NotificationsPage.jsx'));
const MessagesPage = lazy(() => import('./pages/MessagesPage.jsx'));
const ResearchersPage = lazy(() => import('./pages/ResearchersPage.jsx'));
const ResearcherPage = lazy(() => import('./pages/ResearcherPage.jsx'));

function RouteLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="text-sm text-slate-400">Loading…</span>
    </div>
  );
}

function AdaptiveStyleShell({ children }) {
  const { quality, policy } = useNetwork();

  // Phase 3 only exposes the active network quality to CSS. Fast mode has
  // no overrides, so it remains pixel-for-pixel the current experience.
  // Medium and slow modes progressively simplify presentation without
  // changing content, controls, routing, data loading, or offline sync.
  return (
    <div
      className="adaptive-ui flex flex-col min-h-screen"
      data-network-quality={quality}
      data-render-level={policy.renderLevel}
    >
      {children}
    </div>
  );
}

function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = React.useState(false);
  // Global quick search (expeditions/researchers/regions — see
  // ExplorerSearch.jsx) is intentionally a different tool from Archive's
  // own search bar (deep, filtered content search). This dropdown closes
  // itself whenever the route changes, so picking a result and navigating
  // away doesn't leave a stale open panel sitting over the new page.
  const [searchOpen, setSearchOpen] = React.useState(false);
  React.useEffect(() => { setSearchOpen(false); }, [location.pathname]);
  const canUpload = isAuthenticated && ['researcher', 'comms_officer', 'admin'].includes(user?.role);
  const { counts, blockReason, storageLow } = useSyncStatus();
  const [online, setOnline] = React.useState(() => navigator.onLine);

  // Phase 2 (Emergency Alert) — runs for every signed-in user regardless of
  // which page they're on, since a danger report anywhere needs to reach
  // whoever's watching, not just someone parked on that expedition's page.
  useAlertNotifications();

  React.useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  function handleLogout() {
    setProfileOpen(false);
    logout();
    navigate('/');
  }

  // Phase 7: the indicator has to distinguish "the world is broken" (offline,
  // server down) from "you need to do something" (session expired, device
  // full). An expired session used to look identical to a failure, which is
  // how a researcher ends up assuming their work was lost.
  const pendingTotal = counts.queued + counts.uploading + counts.failed;
  const authBlocked = blockReason === SYNC_BLOCK.AUTH;

  const syncLabel = !online
    ? `Offline • ${pendingTotal} pending`
    : authBlocked
      ? 'Sign in to sync'
      : storageLow && counts.queued > 0
        ? `${counts.queued} pending • storage low`
        : counts.uploading > 0
          ? `Syncing ${counts.uploading}/${counts.queued + counts.uploading}`
          : counts.queued > 0
            ? `${counts.queued} pending`
            : counts.failed > 0
              ? `${counts.failed} need attention`
              : 'Synced';

  const syncTone = !online || authBlocked || (storageLow && counts.queued > 0)
    ? 'border-amber-600/60 text-amber-200 bg-amber-950/20'
    : counts.uploading > 0
      ? 'border-cyan-600/60 text-cyan-200 bg-cyan-950/20'
      : counts.failed > 0
        ? 'border-red-600/60 text-red-200 bg-red-950/20'
        : counts.queued > 0
          ? 'border-amber-600/60 text-amber-200 bg-amber-950/20'
          : 'border-emerald-700/60 text-emerald-200 bg-emerald-950/20';

  const syncIcon = !online
    ? <CloudOff className="w-4 h-4" />
    : authBlocked
      ? <KeyRound className="w-4 h-4" />
      : counts.uploading > 0
        ? <RefreshCw className="w-4 h-4 animate-spin" />
        : <Cloud className="w-4 h-4" />;

  const syncTitle = authBlocked
    ? 'Sync paused — sign in again. Nothing has been lost.'
    : 'Open Sync Center';

  return (
    <nav className="h-16 flex items-center justify-between px-6 bg-[#2d5c80] text-white">
      <Link
        to="/"
        className="shrink-0 flex items-center"
        aria-label="NCPOR home"
        title="National Centre for Polar and Ocean Research"
      >
        <img
          src={ncporLogo}
          alt="NCPOR"
          className="h-12 w-12 object-contain"
          decoding="async"
        />
      </Link>

      <div className="flex gap-6 text-sm font-medium">
        <Link to="/" className="text-white">Home</Link>
        <Link to="/explore" className="text-slate-300 hover:text-white">Explore</Link>
        <Link to="/archive" className="text-slate-300 hover:text-white">Archive</Link>
        <Link to="/activities" className="text-slate-300 hover:text-white">Activities</Link>
        <Link to="/communities" className={location.pathname.startsWith('/communities') ? 'text-white' : 'text-slate-300 hover:text-white'}>Communities</Link>
        {isAuthenticated && ['admin', 'comms_officer'].includes(user.role) && (
          <>
            <Link to="/review" className="text-slate-300 hover:text-white">Review Queue</Link>
            <Link to="/accounts" className="text-slate-300 hover:text-white">Accounts</Link>
          </>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            title="Quick search — expeditions, researchers, regions"
            aria-expanded={searchOpen}
            aria-haspopup="dialog"
          >
            <Search className="w-5 h-5 text-slate-300 hover:text-white" />
          </button>

          {searchOpen && (
            <>
              <button
                type="button"
                aria-label="Close search"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setSearchOpen(false)}
              />
              <div
                className="absolute left-0 top-[calc(100%+8px)] z-50 w-[420px] max-w-[90vw] rounded-xl border border-white/10 bg-[#173c50] shadow-2xl py-3"
                role="dialog"
                aria-label="Quick search"
              >
                {/* ExplorerSearch supplies its own px-6 horizontal padding
                    (sized for how it's used on the full-width Explorer
                    page) — this panel deliberately adds none of its own,
                    so the two don't stack into something cramped. */}
                <ExplorerSearch
                  onExpeditionSelect={
                    location.pathname === '/'
                      ? (point) => {
                          // On Landing specifically, hand the picked
                          // expedition to its globe instead of navigating
                          // away — searching for something should show it
                          // in place, not leave the page you searched
                          // from. Off Landing, omitting this prop entirely
                          // lets ExplorerSearch fall back to its normal
                          // navigate-to-expedition-page behavior.
                          window.dispatchEvent(new CustomEvent('landing-globe-focus', { detail: point }));
                          setSearchOpen(false);
                        }
                      : undefined
                  }
                />
                <div className="px-6 pt-2 border-t border-white/10 text-center">
                  <button
                    type="button"
                    onClick={() => { setSearchOpen(false); navigate('/archive'); }}
                    className="text-xs text-cyan-300 hover:text-cyan-200"
                  >
                    Looking for a specific report, dataset, or photo? Search the Archive →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <NetworkModeToggle />

        <button
          type="button"
          onClick={() => navigate('/sync')}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors ${syncTone}`}
          title={syncTitle}
        >
          {syncIcon}
          <span>{syncLabel}</span>
        </button>

        {isAuthenticated ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-white/10 transition focus:outline-none focus:ring-2 focus:ring-white/20"
              aria-expanded={profileOpen}
              aria-haspopup="menu"
            >
              <span className="w-7 h-7 rounded-full overflow-hidden bg-[#1c435c] border border-white/20 flex items-center justify-center text-xs font-semibold text-cyan-100 shrink-0">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  user.name?.[0]?.toUpperCase() || '?'
                )}
              </span>
              <span className="text-sm text-slate-200">
                {user.name} <span className="text-slate-400">({user.role})</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
            </button>

            {profileOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close profile menu"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setProfileOpen(false)}
                />

                <div
                  className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#173c50] shadow-2xl"
                  role="menu"
                >
                  <div className="flex items-center gap-3 px-4 py-4">
                    <span className="w-11 h-11 rounded-full overflow-hidden bg-[#1c435c] border border-white/20 flex items-center justify-center text-sm font-semibold text-cyan-100 shrink-0">
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        user.name?.[0]?.toUpperCase() || '?'
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                      <p className="text-xs text-slate-400 truncate">@{user.role}</p>
                    </div>
                  </div>

                  <div className="h-px bg-white/10" />

                  <div className="p-2">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setProfileOpen(false); navigate('/profile'); }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10 transition"
                    >
                      <User className="w-4 h-4 text-slate-400" />
                      <span>My Profile</span>
                    </button>

                    {canUpload && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setProfileOpen(false); navigate('/upload'); }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10 transition"
                      >
                        <Upload className="w-4 h-4 text-slate-400" />
                        <span>Upload</span>
                      </button>
                    )}


                    {user?.role === 'researcher' && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setProfileOpen(false); navigate('/studio'); }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10 transition"
                      >
                        <Clapperboard className="w-4 h-4 text-cyan-300" />
                        <span>Studio</span>
                      </button>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setProfileOpen(false); navigate('/saved-offline'); }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10 transition"
                    >
                      <HardDriveDownload className="w-4 h-4 text-slate-400" />
                      <span>View Saved Files</span>
                    </button>
                  </div>

                  <div className="h-px bg-white/10" />

                  <div className="p-2">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-300 hover:bg-white/10 transition"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <Link
            to="/login"
            className="px-4 py-1.5 border border-white/30 rounded text-sm hover:bg-white/10 transition"
          >
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}

// Placeholder to prove ProtectedRoute works end to end. Swap this out for
// a real page (or delete it) once you're building actual gated features.
function DashboardPlaceholder() {
  const { user } = useAuth();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0b1c25]">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-white mb-2">Protected page</h1>
        <p className="text-slate-400">Only visible because you're signed in as {user.name}.</p>
      </div>
    </div>
  );
}

function PendingAccountBanner() {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated || !user || user.accountStatus === 'active') return null;

  const copy = {
    pending: 'Your account is awaiting administrator verification. You can browse and search freely, but uploading, submitting metadata, and other write actions unlock once an NCPOR admin approves your account.',
    suspended: 'Your account has been suspended by an NCPOR administrator. Contact NCPOR if you believe this is a mistake.',
    rejected: 'Your registration was not approved. Contact NCPOR for details.',
  }[user.accountStatus];
  if (!copy) return null;

  return (
    <div
      className="px-6 py-2.5 text-sm flex items-center gap-2"
      style={{ background: 'rgba(217,164,65,0.08)', borderBottom: '1px solid var(--brass-dim)', color: 'var(--ice-dim)' }}
    >
      <KeyRound className="w-4 h-4 shrink-0" style={{ color: 'var(--brass-bright)' }} />
      <span>{copy}</span>
    </div>
  );
}

export default function App() {
  // Starts the offline-queue sync engine once for the whole app — it needs
  // to keep working (and catch the 'online' event) no matter which page
  // the researcher happens to be on when the connection comes back.
  React.useEffect(() => {
    initSyncManager();
  }, []);

  return (
    <NetworkProvider>
      <BrowserRouter>
        <AuthProvider>
          <Toaster position="top-right" toastOptions={{ style: { background: '#162933', color: '#fff', border: '1px solid #334155' } }} />
          <AdaptiveStyleShell>
            <Navbar />
            <PendingAccountBanner />
            <main className="flex-1 relative">
              <RouteErrorBoundary>
              <Suspense fallback={<RouteLoading />}>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                  <Route
                    path="/dashboard"
                    element={
                      <ProtectedRoute>
                        <DashboardPlaceholder />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/upload"
                    element={
                      <ProtectedRoute roles={['researcher', 'comms_officer', 'admin']}>
                        <UploadPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/profile"
                    element={
                      <ProtectedRoute>
                        <ProfilePage />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/archive" element={<ArchivePage />} />
                  <Route path="/archive/:id" element={<ArchiveItemPage />} />
                  <Route path="/explore" element={<ExplorerPage />} />
                  <Route path="/sync" element={<SyncCenter />} />
                  <Route
                    path="/studio"
                    element={
                      <ProtectedRoute roles={['researcher']}>
                        <StudioPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/saved-offline"
                    element={
                      <ProtectedRoute>
                        <SavedOfflinePage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/expeditions/:id/visualize"
                    element={
                      <ProtectedRoute roles={['researcher', 'comms_officer', 'admin']}>
                        <VizPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/expeditions/:id"
                    element={
                      <ProtectedRoute roles={['researcher', 'comms_officer', 'admin']}>
                        <ExpeditionPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/review"
                    element={
                      <ProtectedRoute roles={['admin', 'comms_officer']}>
                        <ReviewQueuePage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/accounts"
                    element={
                      <ProtectedRoute roles={['admin', 'comms_officer']}>
                        <AccountApprovalPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/researchers" element={<ResearchersPage />} />
                  <Route path="/researchers/:id" element={<ResearcherPage />} />
                  <Route path="/activities" element={<ActivitiesPage />} />
                  {/* The old single-page community moved into the Communities tab */}
                  <Route path="/community" element={<Navigate to="/communities" replace />} />
                  <Route path="/communities" element={<CommunitiesLayout />}>
                    <Route index element={<CommunityFeedPage key="home" feed="home" />} />
                    <Route path="popular" element={<CommunityFeedPage key="popular" feed="popular" />} />
                    <Route path="news" element={<CommunityFeedPage key="news" feed="news" />} />
                    <Route path="explore" element={<CommunityExplorePage />} />
                    <Route path="search" element={<CommunitySearchPage />} />
                    <Route path="c/:slug" element={<CommunityPage />} />
                    <Route path="c/:slug/manage" element={<ProtectedRoute><ModToolsPage /></ProtectedRoute>} />
                    <Route path="post/:id" element={<PostDetailPage />} />
                    <Route path="u/:id" element={<CommunityUserPage />} />
                    <Route path="submit" element={<ProtectedRoute><CreatePostPage /></ProtectedRoute>} />
                    <Route path="manage" element={<ProtectedRoute><ManageCommunitiesPage /></ProtectedRoute>} />
                    <Route path="notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
                  </Route>
                  <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
                  <Route path="/observations" element={<ObservationPage />} />
                  <Route path="/institutional-activities" element={<InstitutionalActivitiesPage />} />
                </Routes>
              </Suspense>
              </RouteErrorBoundary>
            </main>
          </AdaptiveStyleShell>
        </AuthProvider>
      </BrowserRouter>
    </NetworkProvider>
  );
}
