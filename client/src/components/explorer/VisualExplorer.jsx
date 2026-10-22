import React, { useState, useEffect } from 'react';
import { ImageOff } from 'lucide-react';
import api from '../../api/client.js';

export default function VisualExplorer({ compact = false, previewCount = 5, onViewMore }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get('/content', {
          params: { type: 'photo', status: 'published' },
        });
        setPhotos(Array.isArray(data) ? data : []);
      } catch (e) {
        setPhotos([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const visible = compact ? photos.slice(0, previewCount) : photos;

  return (
    <div className={compact ? 'visual-explorer-preview' : 'visual-explorer brass-plate rounded-xl'}>
      {!compact && (
        <>
          <span className="rivet-bl" aria-hidden="true" />
          <span className="rivet-br" aria-hidden="true" />
          <h2 className="visual-explorer-title plate-label">Expedition gallery</h2>
        </>
      )}
      {compact && (
        <div className="visual-explorer-head">
          <h2 className="visual-explorer-title plate-label">Expedition gallery</h2>
          <button onClick={onViewMore || (() => {})} className="explorer-view-link">View more →</button>
        </div>
      )}
      {loading && <p className="visual-explorer-empty">Loading photographs…</p>}
      {!loading && visible.length === 0 && <p className="visual-explorer-empty">No published photographs available.</p>}
      <div className="visual-explorer-grid">
        {visible.map((p) => (
          <button key={p.id} onClick={() => setLightbox(p)} className="visual-explorer-tile">
            {p.fileUrl || p.file_url ? (
              <img
                src={p.fileUrl || p.file_url}
                alt={p.title || 'Expedition photograph'}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            ) : (
              <div className="visual-explorer-tile-fallback"><ImageOff className="w-5 h-5" aria-hidden="true" /></div>
            )}
            <div className="visual-explorer-tile-body">
              <h3>{p.title || 'Untitled'}</h3>
              <p>{p.expedition?.name || 'Unknown expedition'}</p>
              <p>{p.uploader?.name || 'Unknown researcher'}</p>
            </div>
          </button>
        ))}
      </div>

      {lightbox && (
        <div className="visual-explorer-lightbox" onClick={() => setLightbox(null)}>
          <div className="visual-explorer-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.fileUrl || lightbox.file_url} alt={lightbox.title} />
            <div className="visual-explorer-lightbox-body">
              <h3>{lightbox.title || 'Untitled'}</h3>
              <p>Expedition: {lightbox.expedition?.name || 'Unknown'}</p>
              <p>Publisher: {lightbox.uploader?.name || 'Unknown researcher'}</p>
              <div className="visual-explorer-lightbox-actions">
                {lightbox.expeditionId && (
                  <a href={`/expeditions/${lightbox.expeditionId}`} className="explorer-btn-primary">View expedition</a>
                )}
                <button onClick={() => setLightbox(null)} className="explorer-btn-ghost">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
