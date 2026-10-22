import React, { useEffect, useState } from 'react';
import { ArrowRight, Database, Image as ImageIcon, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchResearchers } from '../../api/researchers.js';

export default function ResearcherExplorer({ previewCount = 4 }) {
  const [researchers, setResearchers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchResearchers()
      .then((items) => { if (active) setResearchers(items); })
      .catch(() => { if (active) setResearchers([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visible = researchers.slice(0, previewCount);

  return (
    <section className="researcher-explorer brass-plate rounded-xl">
      <span className="rivet-bl" aria-hidden="true" />
      <span className="rivet-br" aria-hidden="true" />
      <div className="researcher-explorer-head">
        <div>
          <p className="explorer-eyebrow">Research community</p>
          <h2 className="researcher-explorer-title plate-label">Researchers</h2>
          <p className="researcher-explorer-sub">Discover the scientists behind NCPOR expeditions and research.</p>
        </div>
        <Link to="/researchers" className="explorer-view-link">
          View more <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {loading ? (
        <p className="researcher-explorer-empty">Loading researchers…</p>
      ) : visible.length === 0 ? (
        <p className="researcher-explorer-empty">No researchers are available yet.</p>
      ) : (
        <div className="researcher-explorer-grid">
          {visible.map((researcher) => (
            <Link key={researcher.id} to={`/researchers/${researcher.id}`} className="researcher-card">
              <div className="researcher-card-avatar">
                {researcher.avatarUrl ? (
                  <img src={researcher.avatarUrl} alt={researcher.name} />
                ) : (
                  <UserRound className="w-12 h-12" aria-hidden="true" />
                )}
              </div>
              <div className="researcher-card-body">
                <h3>{researcher.name}</h3>
                <p>{researcher.organization || 'NCPOR'}</p>
                <div className="researcher-card-stats">
                  <span>{researcher.stats?.expeditions || 0} expeditions</span>
                  <span><Database className="w-3 h-3" />{researcher.stats?.datasets || 0}</span>
                  <span><ImageIcon className="w-3 h-3" />{researcher.stats?.photos || 0}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
