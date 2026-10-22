import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapPin, User, ArrowRight, Compass, BarChart3 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { regionColor, regionLabel } from './regionMeta.js';

// /expeditions/:id/visualize is gated to these roles by ProtectedRoute in
// App.jsx — matched here so the button only appears for someone who can
// actually use it, rather than sending a public visitor to a route that
// immediately redirects them away.
const VISUALIZE_ROLES = ['researcher', 'comms_officer', 'admin'];

// Replaces the 3D globe + side panel with a plain list you can actually
// scan: a scrollable card list on the left (filterable by region via
// ExplorerRegionGrid), a detail panel on the right. Selecting a card here,
// clicking a search result in ExplorerSearch, and — on the expedition's own
// page — the "View full expedition record" link all feed the same
// `selected` state, so behaviour is identical no matter how an expedition
// was picked.
export default function ExplorerExpeditionBrowser({ expeditions, status, activeRegion, selected, onSelect }) {
  const { user, isAuthenticated } = useAuth();
  const canVisualize = isAuthenticated && VISUALIZE_ROLES.includes(user?.role);
  const navigate = useNavigate();

  const filtered = useMemo(
    () => (activeRegion ? expeditions.filter((exp) => exp.region === activeRegion) : expeditions),
    [expeditions, activeRegion],
  );

  return (
    <div className="explorer-browser">
      <div className="explorer-browser-list custom-scrollbar">
        {status === 'loading' && <p className="explorer-browser-empty">Charting expeditions…</p>}
        {status === 'error' && <p className="explorer-browser-empty">Couldn't reach the archive.</p>}
        {status === 'ready' && filtered.length === 0 && (
          <p className="explorer-browser-empty">
            {activeRegion ? `No expeditions in ${regionLabel(activeRegion)} yet.` : 'No expeditions yet.'}
          </p>
        )}

        {filtered.map((exp) => {
          const isSelected = selected?.id === exp.id;
          const year = exp.startDate ? new Date(exp.startDate).getFullYear() : null;
          return (
            <button
              key={exp.id}
              type="button"
              onClick={() => onSelect(exp)}
              className={`explorer-exp-card${isSelected ? ' active' : ''}`}
            >
              <span className="explorer-exp-card-accent" style={{ background: regionColor(exp.region) }} aria-hidden="true" />
              <span className="explorer-exp-card-body">
                <span className="explorer-exp-card-top">
                  <span className="explorer-exp-card-name">{exp.name}</span>
                  {year && <span className="explorer-exp-card-year gauge-text">{year}</span>}
                </span>
                <span className="explorer-exp-card-meta">
                  <MapPin className="w-3 h-3" /> {regionLabel(exp.region)}
                  {exp.pi?.name && (
                    <>
                      <span className="explorer-dot">·</span>
                      <User className="w-3 h-3" /> {exp.pi.name}
                    </>
                  )}
                </span>
              </span>
              {canVisualize && (
                <span
                  role="button"
                  tabIndex={0}
                  title="Visualize data"
                  aria-label={`Visualize data for ${exp.name}`}
                  className="explorer-exp-card-viz"
                  onClick={(e) => { e.stopPropagation(); navigate(`/expeditions/${exp.id}/visualize`); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate(`/expeditions/${exp.id}/visualize`);
                    }
                  }}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="explorer-detail brass-plate rounded-xl">
        <span className="rivet-bl" aria-hidden="true" />
        <span className="rivet-br" aria-hidden="true" />

        {selected ? (
          <div className="explorer-detail-body">
            {selected.isStation ? (
              <>
                <p className="explorer-detail-eyebrow">Indian research station</p>
                <h3 className="explorer-detail-title">{selected.name}</h3>
                <p className="explorer-detail-desc">{selected.description || 'No description available yet.'}</p>
                {selected.lat != null && (
                  <dl className="explorer-detail-facts">
                    <div>
                      <dt>Coordinates</dt>
                      <dd className="gauge-text">{selected.lat.toFixed(2)}°, {selected.lng.toFixed(2)}°</dd>
                    </div>
                  </dl>
                )}
              </>
            ) : (
              <>
                <p className="explorer-detail-eyebrow" style={{ color: regionColor(selected.region) }}>
                  {regionLabel(selected.region)}
                </p>
                <h3 className="explorer-detail-title">{selected.name}</h3>
                <p className="explorer-detail-desc">
                  {selected.description || selected.desc || 'No description available yet.'}
                </p>
                <dl className="explorer-detail-facts">
                  <div>
                    <dt>Principal investigator</dt>
                    <dd>{selected.pi?.name || selected.pi || 'Unassigned'}</dd>
                  </div>
                  <div>
                    <dt>Started</dt>
                    <dd>
                      {selected.startDate
                        ? new Date(selected.startDate).toLocaleDateString()
                        : selected.year || 'Not available'}
                    </dd>
                  </div>
                  {selected._count?.contentItems != null && (
                    <div>
                      <dt>Archive items</dt>
                      <dd className="gauge-text">{selected._count.contentItems}</dd>
                    </div>
                  )}
                </dl>
                <div className="explorer-detail-actions">
                  {selected.id && (
                    <Link to={`/expeditions/${selected.id}`} className="explorer-detail-link">
                      View full expedition record <ArrowRight className="w-4 h-4" />
                    </Link>
                  )}
                  {selected.id && canVisualize && (
                    <Link to={`/expeditions/${selected.id}/visualize`} className="explorer-detail-visualize">
                      <BarChart3 className="w-4 h-4" /> Visualize data
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="explorer-detail-empty">
            <Compass className="w-8 h-8" aria-hidden="true" />
            <p>Select an expedition to see its record.</p>
          </div>
        )}
      </div>
    </div>
  );
}
