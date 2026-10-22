import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { searchGlobal } from '../../api/search.js';

export default function ExplorerSearch({ onExpeditionSelect }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); setError(false); return; }
    setLoading(true); setError(false);
    try {
      const r = await searchGlobal(q, 300);
      if (r && r.success && r.data) {
        // backend returns {success:true, results:{researchers:[...],...}} or flat array
        const d = r.data;
        if (d.expeditions || d.datasets || d.regions || d.researchers) { const entries = [["expedition","expeditions"],["dataset","datasets"],["region","regions"],["researcher","researchers"]]; setResults(entries.flatMap(([label,key]) => (d[key] ? d[key].map(x => ({...x, type: label})) : []))); } else if (d.results) setResults(Object.entries(d.results).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => ({...x, type: k.slice(0,-1)})) : [])));
        else if (Array.isArray(d)) setResults(d);
        else setResults([]);
      } else {
        setError(true);
      }
    } catch (e) { setError(true); }
    setLoading(false);
  }, []);

  const handleChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    doSearch(v);
  };

  const handleClear = () => { setQuery(''); setResults([]); setError(false); };

  const handleSelect = (item) => {
    // Only expedition results carry coordinates. Reshape to the same field
    // names the expedition browser's detail panel expects (desc/year
    // instead of description/startDate), so the panel behaves identically
    // whether the expedition was picked from search or from its own card.
    if (item.type === 'expedition' && item.lat != null && item.lng != null && onExpeditionSelect) {
      onExpeditionSelect({
        id: item.id,
        name: item.name,
        region: item.region,
        lat: item.lat,
        lng: item.lng,
        year: item.year,
        pi: item.pi,
        desc: item.description || 'No description available yet.',
      });
      setQuery(''); setResults([]);
      return;
    }

    // An expedition result with no coordinates (shouldn't normally happen,
    // but a region drill-down result — see below — reuses type
    // 'expedition' too) still has its own canonical page to open.
    if (item.type === 'expedition' && item.id) {
      navigate(`/expeditions/${item.id}`);
      setQuery(''); setResults([]);
      return;
    }

    if (item.type === 'dataset' && item.expeditionId) {
      navigate(`/expeditions/${item.expeditionId}`);
      setQuery(''); setResults([]);
      return;
    }

    // Regions are filters/groupings in Explorer. Selecting a region should
    // reveal all expeditions completed in that region; clicking one of those
    // expeditions then opens its canonical expedition page (the branch
    // above, since search.routes.js already tags each with type: 'expedition').
    if (item.type === 'region') {
      const regionExpeditions = Array.isArray(item.expeditions)
        ? item.expeditions.map(e => ({ ...e, type: 'expedition' }))
        : [];
      setResults(regionExpeditions);
      return;
    }

    if (item.type === 'researcher' && item.id) {
      navigate(`/researchers/${item.id}`);
      setQuery(''); setResults([]);
      return;
    }

    setQuery(''); setResults([]);
  };

  const byType = (t) => results.filter(r => (r.type === t || r.type === (t === 'researcher' ? 'researchers' : t === 'expedition' ? 'expeditions' : t === 'dataset' ? 'datasets' : t === 'region' ? 'regions' : t)) && (t !== 'researcher' || (r.name && !r.region && !r.title && !r.lat)));

  return (
    <div className="explorer-search">
      <div className="explorer-search-box">
        <Search className="explorer-search-icon w-4 h-4" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Search researchers, datasets, regions, expeditions…"
          className="explorer-search-input"
        />
        {query && (
          <button onClick={handleClear} className="explorer-search-clear" aria-label="Clear">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {loading && <p className="explorer-search-status">Searching…</p>}
      {error && <p className="explorer-search-status error">Search failed. Try again.</p>}
      {!loading && !error && query.trim() && results.length === 0 && (
        <p className="explorer-search-status">No results.</p>
      )}

      {results.length > 0 && (
        <div className="explorer-search-results brass-plate rounded-xl">
          <span className="rivet-bl" aria-hidden="true" />
          <span className="rivet-br" aria-hidden="true" />
          {['researcher', 'expedition', 'dataset', 'region'].map(type => {
            const group = byType(type);
            if (!group.length) return null;
            return (
              <div key={type} className="explorer-search-group">
                <div className="explorer-search-group-label">{type}</div>
                <ul>
                  {group.map((r, i) => (
                    <li key={i}>
                      <button onClick={() => handleSelect(r)} className="explorer-search-result">
                        <span className="explorer-search-result-name">{r.name || r.title || r.region || '-'}</span>
                        <span className="explorer-search-result-meta">
                          {r.type === 'researcher' ? (r.organization || 'Researcher') : r.region || (r.lat != null ? r.lat.toFixed(2) + ',' + r.lng.toFixed(2) : '')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
