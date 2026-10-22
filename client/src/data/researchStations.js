// Small built-in fallback for the three fixed Indian Antarctic research
// stations shown on the landing globe. The API remains the primary source;
// this copy only keeps the station layer available when the API cannot be
// reached (including an offline visit where the globe bundle is cached).
export const DEFAULT_RESEARCH_STATIONS = Object.freeze([
  Object.freeze({
    id: 'maitri',
    name: 'Maitri',
    lat: -70.77,
    lng: 11.73,
    status: 'active',
    description: 'Indian scientific research station established in 1989.',
  }),
  Object.freeze({
    id: 'bharati',
    name: 'Bharati',
    lat: -69.41,
    lng: 76.19,
    status: 'active',
    description: 'Indian Antarctic research station commissioned in 2012.',
  }),
  Object.freeze({
    id: 'dakshin-gangotri',
    name: 'Dakshin Gangotri',
    lat: -70.08,
    lng: -12.0,
    status: 'historical',
    description: 'First Indian scientific base in Antarctica (1983); now a historical site.',
  }),
]);

export function getDefaultResearchStations() {
  return DEFAULT_RESEARCH_STATIONS.map((station) => ({ ...station }));
}
