// Small helpers shared by every Communities screen.

export function timeAgo(value) {
  if (!value) return '';
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  const units = [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]];
  for (const [label, size] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  }
  return 'just now';
}

export function formatCount(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
}

const PALETTE = ['#ff4500', '#0079d3', '#46d160', '#ffb000', '#7193ff', '#ff66ac', '#0dd3bb', '#cc5289', '#ea0027', '#24a0ed'];
export function colorFor(key = '') {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function initials(name = '') {
  return (name || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

// Insert a Cloudinary transformation right after /upload/ — returns the
// URL untouched when it is not a Cloudinary upload URL.
export function cloudinarySized(url, transform) {
  if (!url || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/${transform}/`);
}

export function imageForQuality(url, imageQuality) {
  if (imageQuality === 'lightweight' || imageQuality === 'cached-only') return cloudinarySized(url, 'f_auto,q_auto:low,c_limit,w_360');
  if (imageQuality === 'reduced') return cloudinarySized(url, 'f_auto,q_auto:eco,c_limit,w_720');
  return cloudinarySized(url, 'f_auto,q_auto,c_limit,w_1200');
}

// ---- "Recent" communities (Reddit sidebar section) ----------------------
const RECENT_KEY = 'ncpor_recent_communities';

export function getRecentCommunities() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function pushRecentCommunity(community) {
  if (!community?.slug) return;
  try {
    const entry = { slug: community.slug, iconColor: community.iconColor || null };
    const next = [entry, ...getRecentCommunities().filter((c) => c.slug !== community.slug)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('ncpor:recent-communities'));
  } catch {
    // storage full / disabled — the Recent list is a convenience only
  }
}

export function clearRecentCommunities() {
  try {
    localStorage.removeItem(RECENT_KEY);
    window.dispatchEvent(new Event('ncpor:recent-communities'));
  } catch { /* ignore */ }
}

export const SUGGESTED_TAGS = [
  'Question', 'Discussion', 'Field Report', 'Expedition Update', 'Dataset', 'Photo',
  'Sea Ice', 'Glaciology', 'Oceanography', 'Biodiversity', 'Climate', 'Equipment', 'Logistics', 'Help Needed',
];

const TAG_COLORS = {
  question: '#0079d3', discussion: '#7193ff', 'field report': '#46d160', 'expedition update': '#0dd3bb',
  dataset: '#ffb000', photo: '#ff66ac', 'help needed': '#ea0027',
};
export function tagColor(tag = '') {
  return TAG_COLORS[tag.toLowerCase()] || colorFor(tag.toLowerCase());
}
