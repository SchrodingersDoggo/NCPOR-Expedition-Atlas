// Phase 5 — Adaptive Asset Quality for expedition photos, plus the later
// adaptive-download addition on top of it.
//
// Scope is deliberately narrow: the only bandwidth-heavy, network-fetched
// asset in the client (besides the globe textures, already handled in
// Phase 4) is the photo grid in the expedition detail panel. Reports are
// download links, datasets are parsed tables, videos show a static
// placeholder with no image fetch — none of those need this, and none of
// this ever touches those file types.
//
// This never creates or stores a new file. Cloudinary transformations are
// applied on the fly by editing the URL, so the same uploaded photo serves
// a different byte size depending on the viewer's connection.

// Cloudinary URLs look like:
//   https://res.cloudinary.com/<cloud>/image/upload/<existing transforms>/<version+public_id>
// Cloudinary applies chained transformation components (separated by "/")
// in the order they appear, and the LAST one wins on final dimensions. The
// existing thumbnailUrl/fileUrl already has an eager c_fill,h_400,w_400
// crop baked in as its first component — so our transform must be inserted
// AFTER that component, not before it, or that pre-existing crop silently
// overrides our width and only the quality/format change actually lands.
// If a URL doesn't look like a Cloudinary upload URL at all, this returns
// it untouched rather than guessing — a plain original image is always
// safer than a broken transform.
function isCloudinaryImageUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'res.cloudinary.com' && parsed.pathname.includes('/image/upload/');
  } catch {
    return false;
  }
}

function withCloudinaryTransform(url, transformSegment) {
  if (!url || !isCloudinaryImageUrl(url)) return url;
  const marker = '/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const afterMarker = idx + marker.length;
  const nextSlash = url.indexOf('/', afterMarker);
  if (nextSlash === -1) {
    // No existing transformation component to chain after — just append.
    return `${url.slice(0, afterMarker)}${transformSegment}/${url.slice(afterMarker)}`;
  }

  const firstComponent = url.slice(afterMarker, nextSlash);
  if (/^v\d+$/.test(firstComponent)) {
    // Original Cloudinary URLs often start directly with the version.
    // Transformations must come before that version segment.
    return `${url.slice(0, afterMarker)}${transformSegment}/${url.slice(afterMarker)}`;
  }

  // Existing transformed/eager URL: keep chaining after its first transform.
  return `${url.slice(0, nextSlash + 1)}${transformSegment}/${url.slice(nextSlash + 1)}`;
}

// --- Preview thumbnails (Photos tab grid) ---
// f_auto: let Cloudinary pick WebP/AVIF for browsers that support it.
// q_auto:<level>: the quality/compression trade-off per tier.
// c_scale,w_<px>: explicit scale mode (not just w_<px>) so this reliably
// shrinks the already-cropped 400x400 square rather than depending on
// Cloudinary's implicit default matching 'scale' behavior.
const PREVIEW_MEDIUM_TRANSFORM = 'f_auto,q_auto:eco,c_scale,w_240';
const PREVIEW_SLOW_TRANSFORM = 'f_auto,q_auto:low,c_scale,w_120';

// imageQuality comes straight from NetworkContext's policy (Phase 2):
// 'full' | 'reduced' | 'lightweight' | 'cached-only'.
//
// 'cached-only' deliberately reuses the SLOW transform rather than building
// its own: the service worker's runtime image cache (sw.js) is keyed by
// exact request URL, so requesting a URL variant that's never been fetched
// before is a guaranteed miss while fully offline. Reusing SLOW's URL means
// if the researcher passed through a low-bandwidth connection recently,
// this is the version most likely already sitting in that cache.
export function getAdaptivePhotoUrl(item, imageQuality) {
  const base = item?.thumbnailUrl || item?.fileUrl;
  if (!base) return base;

  // Phase 10 (MinIO compatibility): adaptive transforms are a photo-only
  // Cloudinary concern. Dataset objects — including historical Cloudinary-
  // backed datasets and new MinIO datasets — must never be rewritten here.
  if (item?.type && item.type !== 'photo') return base;

  switch (imageQuality) {
    case 'reduced':
      return withCloudinaryTransform(base, PREVIEW_MEDIUM_TRANSFORM);
    case 'lightweight':
    case 'cached-only':
      return withCloudinaryTransform(base, PREVIEW_SLOW_TRANSFORM);
    case 'full':
    default:
      return base;
  }
}

// --- Adaptive downloads (clicking a photo to open/download the real file) ---
// Deliberately larger and gentler than the preview transforms above — this
// is the actual photo someone wants to view or keep, not a grid icon, so
// it should still look like a real photo, just capped and compressed
// rather than shrunk to a thumbnail. Fast tier stays completely untouched
// (the true original file, exactly as before this feature existed).
const DOWNLOAD_MEDIUM_TRANSFORM = 'f_auto,q_auto:good,w_1600';
const DOWNLOAD_SLOW_TRANSFORM = 'f_auto,q_auto:eco,w_800';

export function getAdaptivePhotoDownloadUrl(item, imageQuality) {
  const base = item?.fileUrl;
  if (!base) return base;

  // Same boundary as previews: only Cloudinary photos participate in the
  // adaptive-image path. Dataset downloads always use their secure download
  // endpoint and are never modified according to network tier.
  if (item?.type && item.type !== 'photo') return base;

  switch (imageQuality) {
    case 'reduced':
      return withCloudinaryTransform(base, DOWNLOAD_MEDIUM_TRANSFORM);
    case 'lightweight':
    case 'cached-only':
      return withCloudinaryTransform(base, DOWNLOAD_SLOW_TRANSFORM);
    case 'full':
    default:
      return base;
  }
}
