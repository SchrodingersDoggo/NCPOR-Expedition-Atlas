import React, { useMemo } from 'react';
import { projectGeographicPoints } from '../v4Spatial.js';
import { sampleValidVectors } from '../vectorSampling.js';
import { createColorScale, niceTicks } from '../colorScale.js';
import ColorLegend from './ColorLegend.jsx';
import { usePlotSize } from './plotSize.js';

function fmt(value) { const n = Number(value); return Number.isFinite(n) ? Number(n.toPrecision(5)).toString() : '—'; }

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

function degreeLabel(value, axis) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (axis === 'lon' && Math.abs(abs - 180) < 1e-9) return '180°';
  const hemisphere = axis === 'lat' ? (n > 0 ? 'N' : n < 0 ? 'S' : '') : (n > 0 ? 'E' : n < 0 ? 'W' : '');
  return `${Number(abs.toFixed(abs >= 10 ? 2 : 3))}°${hemisphere}`;
}

const VECTOR_FRAME = { left: 76, right: 18, top: 14, bottom: 42 };
const MAX_ARROW_PX = 26;

export function VectorFieldView({ dataset, pair, maxArrows = 700 }) {
  const projected = useMemo(() => {
    const valid = sampleValidVectors(dataset, pair, maxArrows);
    if (!valid.length) return { points: [], projection: null };
    return projectGeographicPoints(valid.map((point) => ({ ...point, value: point.speed })));
  }, [dataset, pair?.u, pair?.v, maxArrows]);
  const arrows = projected.points;
  const scale = useMemo(() => createColorScale(arrows.map((point) => point.speed), { mode: 'sequential' }), [arrows]);
  const plot = usePlotSize({ aspect: 0.6, minHeight: 300 });
  if (!arrows.length) return <p className="viz-note" data-tone="warning">No valid paired vector observations are available for this slice.</p>;
  const V = { ...VECTOR_FRAME, w: plot.width, h: plot.height, left: plot.compact ? 58 : VECTOR_FRAME.left };

  const unit = fieldByKey(dataset, pair?.u)?.unit || '';
  const minX = Math.min(...arrows.map((p) => p.x)); const maxX = Math.max(...arrows.map((p) => p.x));
  const minY = Math.min(...arrows.map((p) => p.y)); const maxY = Math.max(...arrows.map((p) => p.y));
  const padX = Math.max(1, (maxX - minX) * 0.06); const padY = Math.max(1, (maxY - minY) * 0.06);
  const b = { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
  const innerW = V.w - V.left - V.right; const innerH = V.h - V.top - V.bottom;
  const kmPerPx = Math.max((b.maxX - b.minX) / innerW, (b.maxY - b.minY) / innerH);
  const ox = V.left + (innerW - (b.maxX - b.minX) / kmPerPx) / 2;
  const oy = V.top + (innerH - (b.maxY - b.minY) / kmPerPx) / 2;
  const sx = (x) => ox + (x - b.minX) / kmPerPx;
  const sy = (y) => oy + (b.maxY - y) / kmPerPx;
  const frame = { x0: sx(b.minX), x1: sx(b.maxX), y0: sy(b.maxY), y1: sy(b.minY) };
  const maxSpeed = Math.max(...arrows.map((p) => p.speed), 1e-12);
  const projection = projected.projection;
  const latTicks = projection ? niceTicks(projection.meanLatitude + b.minY / projection.kmPerDegreeLat, projection.meanLatitude + b.maxY / projection.kmPerDegreeLat, 5)
    .map((lat) => ({ label: degreeLabel(lat, 'lat'), y: (lat - projection.meanLatitude) * projection.kmPerDegreeLat }))
    .filter((tick) => tick.y >= b.minY && tick.y <= b.maxY) : [];
  const lonTicks = projection ? niceTicks(projection.centerLongitude + b.minX / projection.kmPerDegreeLon, projection.centerLongitude + b.maxX / projection.kmPerDegreeLon, 5)
    .map((lon) => ({ label: degreeLabel(((lon + 180) % 360 + 360) % 360 - 180, 'lon'), x: (lon - projection.centerLongitude) * projection.kmPerDegreeLon }))
    .filter((tick) => tick.x >= b.minX && tick.x <= b.maxX) : [];

  return <div>
    <p className="viz-plot-meta"><span><strong className="viz-text">{arrows.length.toLocaleString()}</strong> arrows (evenly sampled)</span><span>Direction from the eastward/northward components · length and colour show speed</span></p>
    <div className="viz-plot" ref={plot.ref}>
      <svg viewBox={`0 0 ${V.w} ${V.h}`} width="100%" className="block w-full" role="img" aria-label="Ocean current vector field">
        <defs><marker id="viz-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#e4f1f6" /></marker></defs>
        <rect x={frame.x0} y={frame.y0} width={frame.x1 - frame.x0} height={frame.y1 - frame.y0} fill="#081a24" stroke="#2a5165" />
        {latTicks.map((tick) => <g key={`lat-${tick.label}`}><line x1={frame.x0} x2={frame.x1} y1={sy(tick.y)} y2={sy(tick.y)} stroke="rgba(134,163,176,0.14)" /><text x={frame.x0 - 8} y={sy(tick.y) + 4} textAnchor="end" fontSize="12" fill="#86a3b0">{tick.label}</text></g>)}
        {lonTicks.map((tick) => <g key={`lon-${tick.label}`}><line x1={sx(tick.x)} x2={sx(tick.x)} y1={frame.y0} y2={frame.y1} stroke="rgba(134,163,176,0.14)" /><text x={sx(tick.x)} y={frame.y1 + 18} textAnchor="middle" fontSize="12" fill="#86a3b0">{tick.label}</text></g>)}
        {arrows.map((point, index) => {
          const x = sx(point.x);
          const y = sy(point.y);
          const length = Math.max(3, MAX_ARROW_PX * Math.min(1, point.speed / maxSpeed));
          const angle = Math.atan2(-point.v, point.u);
          const x2 = x + Math.cos(angle) * length; const y2 = y + Math.sin(angle) * length;
          const color = scale.color(point.speed);
          return <line key={point.index ?? index} x1={x} y1={y} x2={x2} y2={y2} stroke={color} strokeWidth="1.6" strokeLinecap="round" markerEnd="url(#viz-arrowhead)"><title>{`${fmt(point.lat)}°, ${fmt(point.lon)}° · u=${fmt(point.u)} · v=${fmt(point.v)} · speed=${fmt(point.speed)}${unit ? ` ${unit}` : ''}`}</title></line>;
        })}
        <g transform={`translate(${frame.x1 - 150}, ${frame.y0 + 22})`}>
          <rect x="-10" y="-16" width="152" height="28" rx="6" fill="rgba(6,18,26,0.85)" stroke="#2a5165" />
          <line x1="0" y1="0" x2={MAX_ARROW_PX} y2="0" stroke="#e4f1f6" strokeWidth="1.6" markerEnd="url(#viz-arrowhead)" />
          <text x={MAX_ARROW_PX + 8} y="4" fontSize="12" fill="#e4f1f6">{fmt(maxSpeed)}{unit ? ` ${unit}` : ''}</text>
        </g>
      </svg>
    </div>
    <ColorLegend scale={scale} label="Current speed" unit={unit} />
  </div>;
}
