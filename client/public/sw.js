const CACHE_VERSION = 'ncpor-shell-v4-activities-hub';
const APP_SHELL_CACHE = CACHE_VERSION;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/icons.svg',
  '/manifest.webmanifest',
];

// The globe uses two cross-origin textures. A service worker does not control
// the page that first installs it, so relying only on runtime caching can leave
// these textures uncached after the user's first visit. Warm them explicitly
// during install so the globe can render after an offline refresh.
const EXTERNAL_PRECACHE = [
  'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
  'https://unpkg.com/three-globe/example/img/earth-topology.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(APP_SHELL_CACHE);
    await shell.addAll(APP_SHELL);

    // Pre-cache the globe textures separately. Do not fail the whole service
    // worker installation if the CDN is temporarily unavailable; the normal
    // runtime handler can still cache them later when connectivity returns.
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(
      EXTERNAL_PRECACHE.map(async (url) => {
        const request = new Request(url, { mode: 'cors' });
        const response = await fetch(request);
        if (response.ok) await runtime.put(request, response.clone());
      })
    );

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isAppAsset(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  // Vite emits every build file under /assets/ with a content hash in its
  // name, so these are immutable and safe to cache-first regardless of how
  // they are requested. This matters for offline visualization: Web Worker
  // scripts are requested with destination 'worker', and WebAssembly or
  // other lazily fetched build files with destination '' — neither matched
  // the script/style/font/image list below, so the dataset parser worker
  // was never available offline.
  if (url.pathname.startsWith('/assets/')) return true;
  return request.destination === 'script'
    || request.destination === 'worker'
    || request.destination === 'style'
    || request.destination === 'font'
    || request.destination === 'image';
}

async function handleNavigation(request) {
  const cache = await caches.open(APP_SHELL_CACHE);

  try {
    // Network-first keeps the SPA entry point fresh whenever connectivity is
    // available, while the cached copy lets /upload, /sync, etc. reopen offline.
    const response = await fetch(request);
    if (response.ok) await cache.put('/index.html', response.clone());
    return response;
  } catch {
    return (await cache.match('/index.html')) || (await cache.match('/'));
  }
}

async function handleSameOriginAsset(request) {
  const runtime = await caches.open(RUNTIME_CACHE);
  const cached = await runtime.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) await runtime.put(request, response.clone());
    return response;
  } catch {
    return cached || Response.error();
  }
}

async function handleExternalAsset(request) {
  const runtime = await caches.open(RUNTIME_CACHE);
  const cached = await runtime.match(request);
  if (cached) return cached;

  try {
    // Forward the request as-is — do NOT override its mode. three.js sets
    // crossOrigin="anonymous" on globe textures (so WebGL doesn't taint the
    // canvas) and cross-origin @font-face fonts are always fetched in 'cors'
    // mode per spec — both are real 'cors' requests, not 'no-cors' ones.
    // Forcing { mode: 'no-cors' } here produced an opaque response that the
    // browser then rejected for those 'cors'-mode requests outright ("an
    // opaque response was used for a request whose type is not no-cors"),
    // which is what broke the globe textures and fonts entirely — even
    // fully online. A same-origin-less <img> without crossOrigin set is
    // already 'no-cors' by default, so this still caches opaque responses
    // fine for anything that's genuinely no-cors.
    const response = await fetch(request);
    if (response.type === 'opaque' || response.ok) {
      await runtime.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache API calls. Offline application data belongs in IndexedDB and
  // must continue through the existing Phase 3A-5 queue/sync flow.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isAppAsset(request)) {
    event.respondWith(handleSameOriginAsset(request));
    return;
  }

  // Cache GET image, font, and stylesheet requests from third-party hosts.
  // Images cover the globe textures; font + stylesheet together cover the
  // Google Fonts link in index.html — both pieces are needed, since the
  // @font-face rules (the stylesheet) and the woff2 files it points to are
  // separate requests, and either one missing means the offline fallback
  // font shows up instead of the real one.
  if (
    request.method === 'GET' &&
    url.origin !== self.location.origin &&
    (request.destination === 'image' || request.destination === 'font' || request.destination === 'style')
  ) {
    event.respondWith(handleExternalAsset(request));
  }
});
