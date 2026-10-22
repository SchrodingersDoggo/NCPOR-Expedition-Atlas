import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy } from 'react';
import { X, ChevronRight, Compass, Anchor, Pencil, ImageOff, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchExpeditionsForGlobe } from '../api/expeditions.js';
import { fetchExpeditionContent } from '../api/content.js';
import { fetchAlerts, dangerTypeLabel } from '../api/alerts.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useNetwork } from '../context/NetworkContext.jsx';
import { cacheGlobeExpeditions, getCachedGlobeExpeditions } from '../offline/globeCache.js';
import ExpeditionListFallback from '../components/globe/ExpeditionListFallback.jsx';
import GlobeErrorBoundary from '../components/globe/GlobeErrorBoundary.jsx';
import { getAdaptivePhotoUrl, getAdaptivePhotoDownloadUrl } from '../utils/adaptiveImage.js';
import DangerBadge from '../components/DangerBadge.jsx';
import AlertReportModal from '../components/AlertReportModal.jsx';
import DatasetDownloadButton from '../components/DatasetDownloadButton.jsx';

// Phase 4 — the heavy 3D globe (react-globe.gl + three) lives in its own
// module and is only ever downloaded for FAST/MEDIUM tiers. SLOW/OFFLINE
// never trigger this import, so they never pay for that JS.
const GlobeView = lazy(() => import('../components/globe/GlobeView.jsx'));

function GlobeChunkLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span className="text-sm" style={{ color: 'var(--ice-dim)' }}>Loading globe…</span>
    </div>
  );
}

// Phase 5 — a photo grid tile. Renders the network-appropriate Cloudinary
// variant (see utils/adaptiveImage.js) and falls back to a plain placeholder
// instead of a broken-image icon if that variant isn't available — mainly
// the OFFLINE case, where the request never happens if it isn't already in
// the service worker's cache.
function PhotoThumb({ item, imageQuality }) {
  const [failed, setFailed] = useState(false);
  const src = getAdaptivePhotoUrl(item, imageQuality);

  if (!src || failed) {
    return (
      <div className="w-full h-24 flex items-center justify-center" style={{ background: 'rgba(7,22,32,0.5)' }}>
        <ImageOff className="w-4 h-4" style={{ color: 'var(--ice-dim)' }} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={item.title}
      className="w-full h-24 object-cover"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

// CSS custom properties resolve fine inside the DOM, but the WebGL globe
// reads raw color strings — so pins get resolved hex, everything in the
// 2D chrome keeps the CSS variable so a future palette tweak stays in one place.
const REGION_HEX = {
  Antarctic: '#5b8fd9',
  Arctic: '#6fd4c9',
  Himalaya: '#d99456',
  Southern_Ocean: '#7fbf8f',
};

// Phase 4 — a marker's danger level overrides its region color once it's
// above 'low', since "this location is in trouble" is more urgent
// information than which region it's in. 'low' deliberately has no entry
// here, so untouched expeditions keep their normal region color.
const DANGER_HEX = {
  moderate: '#fbbf24',
  high: '#fb923c',
  critical: '#f87171',
};

const DEFAULT_YEAR_RANGE = { min: 2015, max: new Date().getFullYear() };

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const network = useNetwork();
  const [expeditions, setExpeditions] = useState([]);
  const [loadStatus, setLoadStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [selectedPin, setSelectedPin] = useState(null);

  // Picking an expedition from the navbar's quick search (while already on
  // this page) dispatches this instead of navigating away — see App.jsx's
  // Navbar. Reacting to it here, rather than lifting selectedPin into a
  // shared context, keeps this page's own state as the single source of
  // truth for what the globe focuses on; the navbar just hands it a point.
  useEffect(() => {
    const onFocusRequest = (e) => setSelectedPin(e.detail);
    window.addEventListener('landing-globe-focus', onFocusRequest);
    return () => window.removeEventListener('landing-globe-focus', onFocusRequest);
  }, []);
  const [yearFilter, setYearFilter] = useState(DEFAULT_YEAR_RANGE.max);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth > 768);
  const globeBoxRef = useRef();
  const [globeSize, setGlobeSize] = useState({ width: 0, height: 0 });

  // Expedition Detail Panel — Reports / Photos / Data tabs (Phase 5)
  const [activeTab, setActiveTab] = useState('reports');
  const [panelContent, setPanelContent] = useState({ reports: [], photos: [], data: [] });
  const [panelStatus, setPanelStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'

  // Phase 4 — danger summary for whichever pin is selected: how many
  // alerts have been reported and what the most recent one says. The
  // danger *level* itself already travels on the pin/expedition object
  // (see fetchExpeditionsForGlobe), so this is only the extra detail.
  const [alertSummary, setAlertSummary] = useState({ count: 0, latest: null });
  const [showAlertModal, setShowAlertModal] = useState(false);

  useEffect(() => {
    if (!selectedPin || !isAuthenticated) {
      setAlertSummary({ count: 0, latest: null });
      return;
    }
    let cancelled = false;
    fetchAlerts(selectedPin.id)
      .then((alerts) => {
        if (cancelled) return;
        setAlertSummary({ count: alerts.length, latest: alerts[0] || null });
      })
      .catch(() => {
        if (!cancelled) setAlertSummary({ count: 0, latest: null });
      });
    return () => { cancelled = true; };
  }, [selectedPin?.id, isAuthenticated]);

  // Whenever a new pin is selected, reset to the Reports tab and fetch that
  // expedition's content items fresh (reports/photos/datasets all come back
  // in one call, bucketed by fetchExpeditionContent).
  useEffect(() => {
    if (!selectedPin) {
      setPanelContent({ reports: [], photos: [], data: [] });
      setPanelStatus('idle');
      return;
    }
    setActiveTab('reports');
    setPanelStatus('loading');
    let cancelled = false;
    fetchExpeditionContent(selectedPin.id)
      .then((buckets) => {
        if (cancelled) return;
        setPanelContent(buckets);
        setPanelStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load expedition content', err);
        if (cancelled) return;
        setPanelStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPin?.id]);

  // Load expeditions on mount, and again on an actual online/offline
  // transition (Phase 4) — not on every fast/medium/slow tier change, since
  // those don't change what data is needed, only how it's rendered.
  useEffect(() => {
    let cancelled = false;

    const applyLoadedExpeditions = (data) => {
      if (cancelled) return;
      setExpeditions(data);
      setLoadStatus('ready');
      const years = data.map((e) => e.year).filter(Boolean);
      if (years.length) setYearFilter(Math.max(...years));
    };

    async function loadFromCacheOrFail() {
      const cached = await getCachedGlobeExpeditions();
      if (cancelled) return;
      if (cached?.expeditions?.length) {
        applyLoadedExpeditions(cached.expeditions);
      } else {
        setExpeditions([]);
        setLoadStatus('error');
      }
    }

    async function load() {
      // Offline — Phase 4 says avoid external globe/assets and use
      // cached/core data, so skip the network call entirely.
      if (network.isOffline) {
        await loadFromCacheOrFail();
        return;
      }

      try {
        const data = await fetchExpeditionsForGlobe();
        if (cancelled) return;
        applyLoadedExpeditions(data);
        // Best-effort cache write for the next offline visit — doesn't
        // block or affect the current render either way.
        cacheGlobeExpeditions(data);
      } catch (err) {
        console.error('Failed to load expeditions', err);
        if (cancelled) return;
        // Online but the server's unreachable — fall back to whatever is
        // cached rather than leaving the page dead.
        await loadFromCacheOrFail();
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [network.isOffline]);

  const yearRange = useMemo(() => {
    const years = expeditions.map((e) => e.year).filter(Boolean);
    if (!years.length) return DEFAULT_YEAR_RANGE;
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [expeditions]);

  const yearTicks = useMemo(() => {
    const { min, max } = yearRange;
    if (min === max) return [min];
    const step = (max - min) / 4;
    return Array.from({ length: 5 }, (_, i) => Math.round(min + step * i));
  }, [yearRange]);

  const filteredExpeditions = useMemo(
    () => expeditions
      // Expeditions without a recorded start date are always shown —
      // there's no year to filter them by, so hiding them would just lose data.
      .filter((exp) => exp.year == null || exp.year <= yearFilter)
      .map((exp) => ({ ...exp, hex: DANGER_HEX[exp.dangerLevel] || REGION_HEX[exp.region] || '#8fb3b8' })),
    [expeditions, yearFilter]
  );

  // Track viewport for the mobile/desktop layout switch below.
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // react-globe.gl doesn't auto-fill its parent — it needs explicit
  // width/height. Watch the card's actual size (including when the detail
  // panel opens/closes and resizes it) and feed that in directly.
  useEffect(() => {
    if (!globeBoxRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setGlobeSize({ width, height });
    });
    ro.observe(globeBoxRef.current);
    return () => ro.disconnect();
  }, []);

  const activeRegions = new Set(filteredExpeditions.map(e => e.region));

  // Shared between the real globe and the lightweight fallback so clicking
  // a pin/row behaves identically either way.
  const handleSelectPin = useCallback((point) => setSelectedPin(point), []);

  const globeMode = network.policy.globeMode; // 'full' | 'reduced' | 'lightweight' | 'offline'

  // SLOW never attempts the globe at all — that's the one tier where the
  // spec is explicit that the heavy WebGL/globe assets must not load,
  // full stop. FULL/REDUCED/OFFLINE all attempt it: offline relies on
  // whatever the browser/service worker already has cached (the same way
  // it always could, before the globe was code-split), and the error
  // boundary below only exists to catch the one new failure mode that
  // introduced — the lazy chunk itself failing to load.
  const attemptGlobe = globeMode === 'full' || globeMode === 'reduced' || globeMode === 'offline';
  const [globeFailed, setGlobeFailed] = useState(false);
  const showWebglGlobe = attemptGlobe && !globeFailed;

  // Give the globe a fresh attempt whenever the tier changes — a failure
  // while offline shouldn't stay "stuck" showing the list forever once the
  // connection (and thus the chunk/textures) might be available again.
  useEffect(() => {
    setGlobeFailed(false);
  }, [globeMode]);

  const listStatusLabel = !attemptGlobe
    ? 'Low-bandwidth view'
    : globeMode === 'offline'
      ? 'Offline — showing cached expeditions'
      : "Couldn't load the 3D globe — showing list instead";

  return (
    <div className="chart-backdrop absolute inset-0 w-full h-full flex flex-col p-4 md:p-6 gap-4 overflow-hidden">

      {/* Main row: globe porthole + log panel side by side */}
      <div className="flex-1 flex gap-4 min-h-0">

        {/* Globe porthole */}
        <div
          ref={globeBoxRef}
          className="globe-stage relative flex-1 rounded-[28px] overflow-hidden"
          style={{ background: 'radial-gradient(circle at 50% 45%, #143440, #071620 72%)' }}
        >
          {globeSize.width > 0 && (
            attemptGlobe ? (
              <GlobeErrorBoundary
                resetKey={globeMode}
                onError={() => setGlobeFailed(true)}
                fallback={
                  <ExpeditionListFallback
                    expeditions={filteredExpeditions}
                    selectedPin={selectedPin}
                    onSelectPin={handleSelectPin}
                    statusLabel={listStatusLabel}
                  />
                }
              >
                <Suspense fallback={<GlobeChunkLoading />}>
                  <GlobeView
                    width={globeSize.width}
                    height={globeSize.height}
                    expeditions={filteredExpeditions}
                    selectedPin={selectedPin}
                    onSelectPin={handleSelectPin}
                    reduced={globeMode === 'reduced'}
                  />
                </Suspense>
              </GlobeErrorBoundary>
            ) : (
              <ExpeditionListFallback
                expeditions={filteredExpeditions}
                selectedPin={selectedPin}
                onSelectPin={handleSelectPin}
                statusLabel={listStatusLabel}
              />
            )
          )}

          {/* Status overlay — loading / connection error / no located expeditions yet */}
          {(loadStatus !== 'ready' || filteredExpeditions.length === 0) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="brass-plate rounded-md px-6 py-4 text-center max-w-xs pointer-events-auto">
                <span className="rivet-tl" /><span className="rivet-tr" /><span className="rivet-bl" /><span className="rivet-br" />
                {loadStatus === 'loading' && (
                  <p className="text-sm" style={{ color: 'var(--ice-dim)' }}>Charting expeditions…</p>
                )}
                {loadStatus === 'error' && (
                  network.isOffline ? (
                    <>
                      <p className="text-sm" style={{ color: 'var(--brass-bright)' }}>No cached expeditions yet</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--ice-dim)' }}>Connect once online so they're available offline.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm" style={{ color: 'var(--brass-bright)' }}>Can't reach the archive</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--ice-dim)' }}>Check that the API server is running.</p>
                    </>
                  )
                )}
                {loadStatus === 'ready' && filteredExpeditions.length === 0 && (
                  <p className="text-sm" style={{ color: 'var(--ice-dim)' }}>No charted expeditions yet.</p>
                )}
              </div>
            </div>
          )}

          {/* Porthole vignette + brass ring — frames a circular globe, so
              only shown alongside the real globe, never the list view */}
          {showWebglGlobe && (
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
              <div
                className="porthole-vignette absolute inset-0"
                style={{ background: 'radial-gradient(circle at 50% 50%, transparent 42%, rgba(7,22,32,0.55) 62%, rgba(7,22,32,0.92) 78%)' }}
              />
              <div
                className="porthole-ring absolute top-1/2 left-1/2 rounded-full"
                style={{
                  width: 'min(78vh, 92%)',
                  aspectRatio: '1 / 1',
                  maxWidth: '94%',
                  transform: 'translate(-50%, -50%)',
                  border: '3px solid var(--brass-dim)',
                  boxShadow: '0 0 0 1px rgba(232,198,136,0.35), 0 0 32px rgba(0,0,0,0.5), inset 0 0 24px rgba(0,0,0,0.5)',
                }}
              />
              {/* Rivets around the porthole ring */}
              <div className="porthole-rivets absolute top-1/2 left-1/2" style={{ width: 'min(78vh, 92%)', maxWidth: '94%', aspectRatio: '1 / 1', transform: 'translate(-50%, -50%)' }}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={i}
                    className="porthole-rivet absolute rounded-full"
                    style={{
                      width: 6, height: 6, top: '50%', left: '50%',
                      background: 'radial-gradient(circle at 35% 30%, var(--brass-bright), var(--brass-dim) 70%)',
                      transform: `rotate(${i * 30}deg) translate(0, calc(min(39vh, 46%) * -1)) translate(-50%, -50%)`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Title cartouche, filters/stats/legend plates — positioned to
              sit in the empty corners around a circular globe. The list
              view has no such empty space (it fills the whole box) and
              shows this same information in its own header instead, so
              none of this renders outside the globe views. */}
          {showWebglGlobe && (
            <>
              <div className="absolute top-5 left-5 md:top-7 md:left-7 z-10 pointer-events-none max-w-[280px]">
                <div className="flex items-center gap-2 text-[var(--brass-bright)]">
                  <Compass className="w-4 h-4" strokeWidth={1.5} />
                  <span className="gauge-text text-[11px] tracking-wide">{filteredExpeditions.length} expeditions charted</span>
                </div>
                <h1 className="mt-1 text-[28px] md:text-[32px] leading-tight italic" style={{ fontFamily: 'var(--font-display)', color: 'var(--ice)' }}>
                  Expedition Atlas
                </h1>
                <p className="mt-1 text-sm" style={{ color: 'var(--ice-dim)' }}>
                  India's polar and ocean expeditions, with permanent research bases marked in 3D.
                </p>
              </div>

              {/* Filters plate */}
              <div className="brass-plate rounded-md absolute top-5 right-5 md:top-7 md:right-7 z-10 px-4 py-3 pointer-events-auto">
                <span className="rivet-tl" /><span className="rivet-tr" /><span className="rivet-bl" /><span className="rivet-br" />
                <h3 className="plate-label text-sm text-[var(--brass-bright)]">Chart filters</h3>
                <div className="text-xs mt-0.5" style={{ color: 'var(--ice-dim)' }}>Region and status</div>
              </div>

              {/* Stats plate */}
              <div className="brass-plate rounded-md absolute bottom-5 right-5 z-10 px-4 py-3 pointer-events-none">
                <span className="rivet-tl" /><span className="rivet-tr" /><span className="rivet-bl" /><span className="rivet-br" />
                <div className="flex items-center gap-4">
                  <div>
                    <div className="gauge-text text-xl" style={{ color: 'var(--brass-bright)' }}>{filteredExpeditions.length}</div>
                    <div className="text-[11px]" style={{ color: 'var(--ice-dim)' }}>Expeditions logged</div>
                  </div>
                  <div className="w-px self-stretch" style={{ background: 'var(--brass-dim)' }} />
                  <div>
                    <div className="gauge-text text-xl" style={{ color: 'var(--brass-bright)' }}>{activeRegions.size}</div>
                    <div className="text-[11px]" style={{ color: 'var(--ice-dim)' }}>Regions active</div>
                  </div>
                </div>
              </div>

              {/* Legend plate */}
              <div className="brass-plate rounded-md absolute bottom-5 left-5 z-10 px-4 py-3 pointer-events-none">
                <span className="rivet-tl" /><span className="rivet-tr" /><span className="rivet-bl" /><span className="rivet-br" />
                <h3 className="plate-label text-sm text-[var(--brass-bright)] mb-2">Key</h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" style={{ color: 'var(--ice-dim)' }}>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--region-arctic)' }}></span>Arctic</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--region-antarctic)' }}></span>Antarctic</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--region-himalaya)' }}></span>Himalaya</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--region-southern-ocean)' }}></span>Southern Ocean</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right side: expedition log entry */}
        {selectedPin && isDesktop && (
          <div className="expedition-detail-panel w-[420px] shrink-0 rounded-[20px] shadow-2xl flex flex-col overflow-hidden" style={{ background: 'linear-gradient(165deg, var(--hull-light), var(--hull))', border: '1px solid var(--brass-dim)' }}>
            <div className="px-6 pt-6 pb-4 relative flex items-start gap-4" style={{ borderBottom: '1px solid rgba(195,154,94,0.25)' }}>
              {/* Wax-seal style region stamp */}
              <div
                className="expedition-pin-badge shrink-0 w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: `radial-gradient(circle at 35% 30%, ${selectedPin.hex || '#8fb3b8'}, ${selectedPin.hex || '#8fb3b8'}99 70%)`, boxShadow: 'inset 0 0 0 2px rgba(7,22,32,0.35), 0 2px 6px rgba(0,0,0,0.4)' }}
              >
                <Anchor className="w-5 h-5" color="#071620" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <h2 className="italic text-xl leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--ice)' }}>{selectedPin.name}</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ice-dim)' }}>{selectedPin.region ? selectedPin.region.replace('_', ' ') : 'Region not recorded'}</p>
              </div>
              <button onClick={() => setSelectedPin(null)} className="absolute right-4 top-4 p-1 rounded hover:bg-white/10 transition-colors" style={{ color: 'var(--ice-dim)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Phase 4 — danger status + a direct path to report one, right where
                the researcher is already looking at this location. */}
            <div className="px-6 pt-4 pb-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid rgba(195,154,94,0.25)' }}>
              <div className="flex items-center gap-3">
                <DangerBadge level={selectedPin.dangerLevel} />
                {alertSummary.count > 0 && (
                  <span className="text-xs" style={{ color: 'var(--ice-dim)' }}>{alertSummary.count} active alert{alertSummary.count === 1 ? '' : 's'}</span>
                )}
              </div>
              {isAuthenticated && (
                <button
                  onClick={() => setShowAlertModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-red-700/60 text-red-300 hover:bg-red-950/40"
                >
                  <TriangleAlert className="w-3.5 h-3.5" /> Report Danger
                </button>
              )}
            </div>
            {alertSummary.latest && (
              <div className="px-6 py-2 text-xs" style={{ color: 'var(--ice-dim)', borderBottom: '1px solid rgba(195,154,94,0.25)' }}>
                Latest: {dangerTypeLabel(alertSummary.latest.type)}
                {alertSummary.latest.message ? ` — ${alertSummary.latest.message}` : ''}
                {' · '}{new Date(alertSummary.latest.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}

            {showAlertModal && (
              <AlertReportModal
                expeditionId={selectedPin.id}
                onClose={() => setShowAlertModal(false)}
                onSent={(alert) => {
                  // Reflect the escalation immediately: the pin's color on
                  // the globe, the badge here, and the fallback list all
                  // read from the same `dangerLevel` field on `expeditions`.
                  if (alert.expedition?.dangerLevel) {
                    setExpeditions((prev) => prev.map((exp) => (
                      exp.id === selectedPin.id ? { ...exp, dangerLevel: alert.expedition.dangerLevel } : exp
                    )));
                    setSelectedPin((prev) => (prev ? { ...prev, dangerLevel: alert.expedition.dangerLevel } : prev));
                  }
                  setAlertSummary((prev) => ({ count: prev.count + 1, latest: alert }));
                }}
              />
            )}

            <div className="px-6 py-4 overflow-y-auto flex-1 custom-scrollbar">

              <div className="flex gap-6 mb-4">
                <div>
                  <div className="text-[11px]" style={{ color: 'var(--ice-dim)' }}>Year</div>
                  <div className="gauge-text text-sm" style={{ color: 'var(--brass-bright)' }}>{selectedPin.year}</div>
                </div>
                <div>
                  <div className="text-[11px]" style={{ color: 'var(--ice-dim)' }}>Principal investigator</div>
                  <div className="text-sm" style={{ color: 'var(--ice)' }}>{selectedPin.pi}</div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mb-6">
                <p className="text-sm leading-relaxed" style={{ color: 'var(--ice-dim)' }}>{selectedPin.desc}</p>
                {isAuthenticated && (
                  <Link
                    to={`/expeditions/${selectedPin.id}`}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
                    style={{ border: '1px solid rgba(195,154,94,0.35)', color: 'var(--brass-bright)' }}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </Link>
                )}
              </div>

              <div className="flex gap-6 px-0.5 mb-4" style={{ borderBottom: '1px solid rgba(195,154,94,0.25)' }}>
                {[
                  { key: 'reports', label: 'Reports' },
                  { key: 'photos', label: 'Photos' },
                  { key: 'data', label: 'Data' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className="pb-2 text-sm transition-colors"
                    style={
                      activeTab === tab.key
                        ? { fontWeight: 500, color: 'var(--brass-bright)', borderBottom: '2px solid var(--brass-bright)' }
                        : { color: 'var(--ice-dim)' }
                    }
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {panelStatus === 'loading' && (
                <div className="rounded-lg p-8 flex items-center justify-center min-h-[140px] mb-6 text-center" style={{ background: 'rgba(7,22,32,0.35)', border: '1px dashed rgba(195,154,94,0.3)' }}>
                  <span className="text-sm" style={{ color: 'var(--ice-dim)' }}>Loading…</span>
                </div>
              )}

              {panelStatus === 'error' && (
                <div className="rounded-lg p-8 flex items-center justify-center min-h-[140px] mb-6 text-center" style={{ background: 'rgba(7,22,32,0.35)', border: '1px dashed rgba(195,154,94,0.3)' }}>
                  <span className="text-sm" style={{ color: 'var(--ice-dim)' }}>Couldn't load content for this expedition.</span>
                </div>
              )}

              {panelStatus === 'ready' && activeTab === 'reports' && (
                panelContent.reports.length === 0 ? (
                  <div className="rounded-lg p-8 flex items-center justify-center min-h-[140px] mb-6 text-center" style={{ background: 'rgba(7,22,32,0.35)', border: '1px dashed rgba(195,154,94,0.3)' }}>
                    <span className="text-sm" style={{ color: 'var(--ice-dim)' }}>No reports logged yet for this expedition.</span>
                  </div>
                ) : (
                  <div className="space-y-3 mb-6">
                    {panelContent.reports.map((item) => (
                      <a
                        key={item.id}
                        href={item.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg p-4 transition-colors hover:bg-white/5"
                        style={{ background: 'rgba(7,22,32,0.35)', border: '1px solid rgba(195,154,94,0.2)' }}
                      >
                        <div className="text-sm font-medium" style={{ color: 'var(--ice)' }}>{item.title}</div>
                        {item.description && (
                          <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--ice-dim)' }}>{item.description}</p>
                        )}
                      </a>
                    ))}
                  </div>
                )
              )}

              {panelStatus === 'ready' && activeTab === 'photos' && (
                panelContent.photos.length === 0 ? (
                  <div className="rounded-lg p-8 flex items-center justify-center min-h-[140px] mb-6 text-center" style={{ background: 'rgba(7,22,32,0.35)', border: '1px dashed rgba(195,154,94,0.3)' }}>
                    <span className="text-sm" style={{ color: 'var(--ice-dim)' }}>No photos or videos logged yet for this expedition.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    {panelContent.photos.map((item) => (
                      <a
                        key={item.id}
                        href={item.type === 'photo' ? getAdaptivePhotoDownloadUrl(item, network.policy.imageQuality) : item.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg overflow-hidden"
                        style={{ border: '1px solid rgba(195,154,94,0.2)' }}
                      >
                        {item.type === 'photo' ? (
                          <PhotoThumb item={item} imageQuality={network.policy.imageQuality} />
                        ) : (
                          <div className="w-full h-24 flex items-center justify-center" style={{ background: 'rgba(7,22,32,0.5)' }}>
                            <span className="text-xs" style={{ color: 'var(--ice-dim)' }}>Video</span>
                          </div>
                        )}
                        <div className="px-2 py-1 text-xs truncate" style={{ color: 'var(--ice)' }}>{item.title}</div>
                      </a>
                    ))}
                  </div>
                )
              )}

              {panelStatus === 'ready' && activeTab === 'data' && (
                panelContent.data.length === 0 ? (
                  <div className="rounded-lg p-8 flex items-center justify-center min-h-[140px] mb-6 text-center" style={{ background: 'rgba(7,22,32,0.35)', border: '1px dashed rgba(195,154,94,0.3)' }}>
                    <span className="text-sm" style={{ color: 'var(--ice-dim)' }}>No datasets logged yet for this expedition.</span>
                  </div>
                ) : (
                  <div className="mb-6 space-y-4">
                    {panelContent.data.map((item) => (
                      <div key={item.id}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium" style={{ color: 'var(--ice)' }}>{item.title}</span>
                          <DatasetDownloadButton
                            itemId={item.id}
                            label="Download"
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors hover:bg-white/5 disabled:opacity-60"
                            style={{ border: '1px solid rgba(195,154,94,0.3)', color: 'var(--brass-bright)' }}
                          />
                        </div>
                        {item.datasetMeta ? (
                          <div
                            className="rounded-lg p-4"
                            style={{ background: 'rgba(7,22,32,0.35)', border: '1px solid rgba(195,154,94,0.2)' }}
                          >
                            <p className="text-xs mb-3" style={{ color: 'var(--ice-dim)' }}>
                              {item.datasetMeta.row_count} rows · {item.datasetMeta.columns?.length ?? 0} columns
                            </p>

                            {/* Column list */}
                            <div className="flex flex-wrap gap-2 mb-3">
                              {item.datasetMeta.columns?.map((col, i) => (
                                <span
                                  key={i}
                                  className="text-[11px] px-2 py-0.5 rounded-full"
                                  style={{ border: '1px solid rgba(195,154,94,0.25)', color: 'var(--ice-dim)' }}
                                >
                                  {col.name}
                                  <span style={{ color: 'var(--brass-dim)' }}> · {col.type}</span>
                                </span>
                              ))}
                            </div>

                            {/* Preview table */}
                            <div className="rounded-md overflow-x-auto" style={{ background: 'rgba(7,22,32,0.4)' }}>
                              <table className="w-full text-xs" style={{ color: 'var(--ice-dim)' }}>
                                <thead>
                                  <tr>
                                    {item.datasetMeta.columns?.map((col) => (
                                      <th
                                        key={col.name}
                                        className="p-2 text-left"
                                        style={{ borderBottom: '1px solid rgba(195,154,94,0.2)', color: 'var(--ice)' }}
                                      >
                                        {col.name}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(item.datasetMeta.preview_rows || []).slice(0, 8).map((row, rIdx) => (
                                    <tr key={rIdx}>
                                      {row.map((cell, cIdx) => (
                                        <td key={cIdx} className="p-2" style={{ borderBottom: '1px solid rgba(195,154,94,0.1)' }}>
                                          {cell !== null && cell !== undefined ? String(cell) : ''}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs" style={{ color: 'var(--ice-dim)' }}>No preview available for this dataset.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}

            </div>

            <div className="px-6 pb-6 pt-2">
              <Link
                to={`/expeditions/${selectedPin.id}`}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-lg font-medium transition-colors hover:bg-white/5"
                style={{ border: '1px solid var(--brass-dim)', color: 'var(--brass-bright)' }}
              >
                <span>View full expedition record</span>
                <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Depth-gauge timeline */}
      <div className="h-14 shrink-0 flex items-center gap-4">
        <span className="gauge-text text-sm" style={{ color: 'var(--brass-bright)' }}>{yearRange.min}</span>
        <div className="relative flex-1 h-6 flex items-center">
          <div className="absolute w-full h-px" style={{ background: 'rgba(195,154,94,0.35)' }} />
          {yearTicks.map(yr => (
            <div key={yr} className="absolute flex flex-col items-center" style={{ left: `${yearRange.max === yearRange.min ? 0 : ((yr - yearRange.min) / (yearRange.max - yearRange.min)) * 100}%`, transform: 'translateX(-50%)' }}>
              <div className="w-px h-2" style={{ background: 'rgba(195,154,94,0.5)' }} />
            </div>
          ))}
          <input
            type="range"
            min={yearRange.min} max={yearRange.max}
            value={yearFilter}
            onChange={(e) => setYearFilter(parseInt(e.target.value))}
            className="absolute w-full opacity-0 cursor-pointer h-full z-10"
          />
          <div
            className="timeline-knob absolute rounded-full flex items-center justify-center"
            style={{
              left: `calc(${yearRange.max === yearRange.min ? 0 : ((yearFilter - yearRange.min) / (yearRange.max - yearRange.min)) * 100}% - 9px)`,
              width: 18, height: 18,
              background: 'radial-gradient(circle at 35% 30%, var(--brass-bright), var(--brass-dim) 70%)',
              boxShadow: '0 0 0 3px rgba(7,22,32,0.6)',
            }}
          >
            <Anchor className="w-2.5 h-2.5" color="#071620" strokeWidth={2.5} />
          </div>
        </div>
        <span className="gauge-text text-sm" style={{ color: 'var(--brass-bright)' }}>{yearRange.max}</span>
        <div className="hidden sm:block ml-4 text-sm" style={{ color: 'var(--ice-dim)' }}>Drag to explore expeditions by year</div>
      </div>
    </div>
  );
}
