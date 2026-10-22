// Shared region metadata for the Explorer page — one source of truth for
// label, accent color and a one-line blurb, so the stat grid, the region
// cards, the timeline and the expedition browser never drift out of sync
// with each other.
export const REGIONS = [
  {
    value: 'Arctic',
    label: 'Arctic',
    blurb: "India's Arctic research programme, run out of Himadri station in Svalbard.",
    varColor: 'var(--region-arctic)',
  },
  {
    value: 'Antarctic',
    label: 'Antarctic',
    blurb: 'Decades of fieldwork out of Maitri and Bharati stations.',
    varColor: 'var(--region-antarctic)',
  },
  {
    value: 'Himalaya',
    label: 'Himalaya',
    blurb: 'High-altitude glaciology and cryosphere studies across the Himalayan range.',
    varColor: 'var(--region-himalaya)',
  },
  {
    value: 'Southern_Ocean',
    label: 'Southern Ocean',
    blurb: 'Shipborne oceanographic transects south of 40°S.',
    varColor: 'var(--region-southern-ocean)',
  },
];

export const REGION_BY_VALUE = Object.fromEntries(REGIONS.map((r) => [r.value, r]));

export function regionColor(region) {
  return REGION_BY_VALUE[region]?.varColor || 'var(--ice-dim)';
}

export function regionLabel(region) {
  return REGION_BY_VALUE[region]?.label || (region ? region.replace(/_/g, ' ') : 'Unassigned');
}
