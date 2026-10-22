import React, { useEffect, useMemo, useState } from 'react';
import {
  curtainMeasurements,
  depthRange,
  depthSliceMeasurements,
  interpolateBoundedGrid,
  surfaceMeasurements,
} from '../v4Spatial.js';
import { createColorScale, niceTicks, paletteForVariable, scaleSwatchColor } from '../colorScale.js';
import ColorLegend from './ColorLegend.jsx';
import { usePlotSize } from './plotSize.js';
import { variableName } from '../ui/labels.js';

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

function fmt(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (Math.abs(n) >= 1e5 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) return n.toExponential(3);
  return Number(n.toPrecision(6)).toString();
}

function degreeLabel(value, axis) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (axis === 'lon' && Math.abs(abs - 180) < 1e-9) return '180°';
  const hemisphere = axis === 'lat' ? (n > 0 ? 'N' : n < 0 ? 'S' : '') : (n > 0 ? 'E' : n < 0 ? 'W' : '');
  return `${Number(abs.toFixed(abs >= 10 ? 2 : 3))}°${hemisphere}`;
}

function wrapLongitude(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

const MEASURED_KEY = { label: 'Measured observation', color: 'transparent', stroke: '#ffffff' };
const INTERPOLATED_KEY = { kind: 'swatch', label: 'Interpolated estimate (fainter = less confident)', color: '#5598e7', opacity: 0.6 };

function GridLegend({ variable, grid, scale }) {
  return <ColorLegend
    scale={scale}
    label={variableName(variable) || 'Variable'}
    unit={variable?.unit}
    keys={grid.cells.length ? [MEASURED_KEY, { ...INTERPOLATED_KEY, color: scaleSwatchColor(scale) }] : [MEASURED_KEY]}
    note={grid.cells.length ? null : 'Interpolation withheld — measured locations only'}
  />;
}

function CoverageNote({ grid }) {
  if (!grid.resolution?.cells) return null;
  return <p className="viz-plot-caption">
    Grid {grid.resolution.nx}×{grid.resolution.ny}: {grid.cells.length.toLocaleString()} of {grid.resolution.cells.toLocaleString()} cells lie inside the coverage mask. Nothing is drawn outside the measured area or beyond the local-distance limit.
  </p>;
}

// ---------------------------------------------------------------- curtain
const CURTAIN = { left: 72, right: 18, top: 14, bottom: 44 };

function CurtainSvg({ grid, variable, verticalLabel, verticalUnit, track }) {
  const scale = useMemo(() => createColorScale([...grid.cells.map((cell) => cell.value), ...grid.measured.map((point) => point.value)], { palette: paletteForVariable(variable) }), [grid, variable]);
  const plot = usePlotSize({ aspect: 0.54, minHeight: 300 });
  if (!grid.cells.length || !grid.bounds) return <p className="viz-note" data-tone="warning">There is not enough two-dimensional track/depth coverage to interpolate a curtain section safely.</p>;
  const C = { ...CURTAIN, w: plot.width, h: plot.height, left: plot.compact ? 58 : CURTAIN.left };
  const { minX, maxX, minY, maxY } = grid.bounds;
  const width = Math.max(Number.EPSILON, maxX - minX);
  const height = Math.max(Number.EPSILON, maxY - minY);
  const innerW = C.w - C.left - C.right;
  const innerH = C.h - C.top - C.bottom;
  const sx = (x) => C.left + ((x - minX) / width) * innerW;
  const sy = (y) => C.top + ((y - minY) / height) * innerH;
  const cellW = innerW / Math.max(1, grid.resolution.nx - 1);
  const cellH = innerH / Math.max(1, grid.resolution.ny - 1);
  const xTicks = niceTicks(minX, maxX, 6).filter((tick) => tick >= minX && tick <= maxX);
  const yTicks = niceTicks(minY, maxY, 6).filter((tick) => tick >= minY && tick <= maxY);
  return <>
    <div className="viz-plot" ref={plot.ref}>
      <svg viewBox={`0 0 ${C.w} ${C.h}`} width="100%" className="block w-full" role="img" aria-label="Interpolated oceanographic curtain section">
        <rect x={C.left} y={C.top} width={innerW} height={innerH} fill="#081a24" stroke="#2a5165" />
        {grid.cells.map((cell, index) => <rect key={`${cell.ix}-${cell.iy}-${index}`} x={sx(cell.x) - cellW / 2} y={sy(cell.y) - cellH / 2} width={cellW + 0.6} height={cellH + 0.6} fill={scale.color(cell.value)} opacity={0.55 + cell.confidence * 0.45}><title>{`Interpolated · ${variableName(variable) || 'value'} ${fmt(cell.value)}${variable?.unit ? ` ${variable.unit}` : ''} · ${fmt(cell.x)} km along track · ${verticalLabel} ${fmt(cell.y)} · confidence ${Math.round(cell.confidence * 100)}%`}</title></rect>)}
        {xTicks.map((tick) => <g key={`x-${tick}`}><line x1={sx(tick)} x2={sx(tick)} y1={C.top + innerH} y2={C.top + innerH + 5} stroke="#86a3b0" /><text x={sx(tick)} y={C.top + innerH + 19} textAnchor="middle" fontSize="12" fill="#86a3b0">{fmt(tick)}</text></g>)}
        {yTicks.map((tick) => <g key={`y-${tick}`}><line x1={C.left - 5} x2={C.left} y1={sy(tick)} y2={sy(tick)} stroke="#86a3b0" /><text x={C.left - 9} y={sy(tick) + 4} textAnchor="end" fontSize="12" fill="#86a3b0">{fmt(tick)}</text></g>)}
        {(track || []).map((entry, index) => <line key={`cast-${index}`} x1={sx(entry.distanceKm)} x2={sx(entry.distanceKm)} y1={C.top} y2={C.top + innerH} stroke="rgba(228,241,246,0.22)" strokeDasharray="3 4"><title>{`Cast at ${fmt(entry.distanceKm)} km`}</title></line>)}
        {grid.measured.map((point, index) => <circle key={`m-${index}`} cx={sx(point.x)} cy={sy(point.y)} r="1.8" fill={scale.color(point.value)} stroke="#ffffff" strokeWidth="0.7" strokeOpacity="0.85"><title>{`Measured · ${variableName(variable) || 'value'} ${fmt(point.value)}${variable?.unit ? ` ${variable.unit}` : ''} · ${fmt(point.x)} km along track · ${verticalLabel} ${fmt(point.y)}`}</title></circle>)}
        <text x={C.left + innerW / 2} y={C.h - 6} textAnchor="middle" fill="#b3cad4" fontSize="13">Distance along cast track (km)</text>
        <text x="16" y={C.top + innerH / 2} textAnchor="middle" fill="#b3cad4" fontSize="13" transform={`rotate(-90 16 ${C.top + innerH / 2})`}>{verticalLabel}{verticalUnit ? ` (${verticalUnit})` : ''} — increases downward</text>
      </svg>
    </div>
    <GridLegend variable={variable} grid={grid} scale={scale} />
    <CoverageNote grid={grid} />
  </>;
}

// ---------------------------------------------------------------- spatial grid (slice / surface)
const SPATIAL = { left: 76, right: 18, top: 14, bottom: 42 };

function SpatialGridSvg({ grid, variable, label }) {
  const scale = useMemo(() => createColorScale([...grid.cells.map((cell) => cell.value), ...grid.measured.map((point) => point.value)], { palette: paletteForVariable(variable) }), [grid, variable]);
  const plot = usePlotSize({ aspect: 0.58, minHeight: 300 });
  if (!grid.bounds || !grid.measured.length) return <p className="viz-note" data-tone="warning">There are not enough valid measured positions for this spatial layer.</p>;
  const P = { ...SPATIAL, w: plot.width, h: plot.height, left: plot.compact ? 58 : SPATIAL.left };
  const { minX, maxX, minY, maxY } = grid.bounds;
  const padX = Math.max(1, (maxX - minX) * 0.06);
  const padY = Math.max(1, (maxY - minY) * 0.06);
  const b = { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
  const innerW = P.w - P.left - P.right;
  const innerH = P.h - P.top - P.bottom;
  // Equal kilometres per pixel on both axes, so the layer is not stretched.
  const kmPerPx = Math.max((b.maxX - b.minX) / innerW, (b.maxY - b.minY) / innerH);
  const ox = P.left + (innerW - (b.maxX - b.minX) / kmPerPx) / 2;
  const oy = P.top + (innerH - (b.maxY - b.minY) / kmPerPx) / 2;
  const sx = (x) => ox + (x - b.minX) / kmPerPx;
  const sy = (y) => oy + (b.maxY - y) / kmPerPx;
  const frame = { x0: sx(b.minX), x1: sx(b.maxX), y0: sy(b.maxY), y1: sy(b.minY) };
  const cellW = grid.resolution.nx > 1 ? ((maxX - minX) / (grid.resolution.nx - 1)) / kmPerPx : 0;
  const cellH = grid.resolution.ny > 1 ? ((maxY - minY) / (grid.resolution.ny - 1)) / kmPerPx : 0;
  const projection = grid.geographic ? grid.projection : null;
  const latTicks = projection
    ? niceTicks(projection.meanLatitude + b.minY / projection.kmPerDegreeLat, projection.meanLatitude + b.maxY / projection.kmPerDegreeLat, 5)
      .map((lat) => ({ label: degreeLabel(lat, 'lat'), y: (lat - projection.meanLatitude) * projection.kmPerDegreeLat }))
      .filter((tick) => tick.y >= b.minY && tick.y <= b.maxY)
    : niceTicks(b.minY, b.maxY, 5).map((value) => ({ label: fmt(value), y: value }));
  const lonTicks = projection
    ? niceTicks(projection.centerLongitude + b.minX / projection.kmPerDegreeLon, projection.centerLongitude + b.maxX / projection.kmPerDegreeLon, 5)
      .map((lon) => ({ label: degreeLabel(wrapLongitude(lon), 'lon'), x: (lon - projection.centerLongitude) * projection.kmPerDegreeLon }))
      .filter((tick) => tick.x >= b.minX && tick.x <= b.maxX)
    : niceTicks(b.minX, b.maxX, 5).map((value) => ({ label: fmt(value), x: value }));
  return <>
    <div className="viz-plot" ref={plot.ref}>
      <svg viewBox={`0 0 ${P.w} ${P.h}`} width="100%" className="block w-full" role="img" aria-label={label}>
        <rect x={frame.x0} y={frame.y0} width={frame.x1 - frame.x0} height={frame.y1 - frame.y0} fill="#081a24" stroke="#2a5165" />
        {latTicks.map((tick) => <g key={`lat-${tick.label}`}><line x1={frame.x0} x2={frame.x1} y1={sy(tick.y)} y2={sy(tick.y)} stroke="rgba(134,163,176,0.14)" /><text x={frame.x0 - 8} y={sy(tick.y) + 4} textAnchor="end" fontSize="12" fill="#86a3b0">{tick.label}</text></g>)}
        {lonTicks.map((tick) => <g key={`lon-${tick.label}`}><line x1={sx(tick.x)} x2={sx(tick.x)} y1={frame.y0} y2={frame.y1} stroke="rgba(134,163,176,0.14)" /><text x={sx(tick.x)} y={frame.y1 + 18} textAnchor="middle" fontSize="12" fill="#86a3b0">{tick.label}</text></g>)}
        {grid.cells.map((cell, index) => <rect key={`${cell.ix}-${cell.iy}-${index}`} x={sx(cell.x) - cellW / 2} y={sy(cell.y) - cellH / 2} width={cellW + 0.6} height={cellH + 0.6} fill={scale.color(cell.value)} opacity={0.3 + cell.confidence * 0.65}><title>{`Interpolated · ${variableName(variable) || 'value'} ${fmt(cell.value)}${variable?.unit ? ` ${variable.unit}` : ''} · ${grid.geographic ? `${fmt(cell.lat)}°, ${fmt(cell.lon)}°` : `${fmt(cell.y)}, ${fmt(cell.x)}`} · confidence ${Math.round(cell.confidence * 100)}%`}</title></rect>)}
        {grid.measured.map((point, index) => <circle key={`m-${index}`} cx={sx(point.x)} cy={sy(point.y)} r="5.5" fill={scale.color(point.value)} stroke="#ffffff" strokeWidth="1.4"><title>{`Measured · ${variableName(variable) || 'value'} ${fmt(point.value)}${variable?.unit ? ` ${variable.unit}` : ''} · ${grid.geographic ? `${fmt(point.lat)}°, ${fmt(point.lon)}°` : `${fmt(point.y)}, ${fmt(point.x)}`}`}</title></circle>)}
        {!grid.geographic && <text x={P.left + innerW / 2} y={P.h - 6} textAnchor="middle" fill="#b3cad4" fontSize="13">X</text>}
      </svg>
    </div>
    {!grid.cells.length && <p className="viz-note mt-2" data-tone="warning">Interpolation withheld: the measured positions do not cover enough two-dimensional area. Measured locations are shown without inventing a surface.</p>}
    <GridLegend variable={variable} grid={grid} scale={scale} />
    <CoverageNote grid={grid} />
  </>;
}

export function CurtainSectionView({ dataset, variableKey }) {
  const variable = fieldByKey(dataset, variableKey);
  const section = useMemo(() => curtainMeasurements(dataset, variableKey), [dataset, variableKey]);
  const grid = useMemo(() => interpolateBoundedGrid(section.points, { maxCells: 6000, maxSourcePoints: 1800 }), [section.points]);
  if (section.track.length < 2) return <p className="viz-note" data-tone="warning">At least two casts at distinct valid locations are required.</p>;
  return <div>
    <div className="viz-plot-meta"><span><strong className="viz-text">{section.track.length}</strong> casts</span><span><strong className="viz-text">{fmt(section.track.at(-1)?.distanceKm || 0)} km</strong> track</span><span>{section.points.length.toLocaleString()} measured samples</span><span>Order: {section.orderMode === 'chronological' ? 'by cast time' : 'source order'}</span></div>
    {section.warning && <p className="viz-note mb-3" data-tone="warning">{section.warning}</p>}
    <CurtainSvg grid={grid} variable={variable} verticalLabel={section.verticalKind === 'pressure' ? 'Pressure' : 'Depth'} verticalUnit={dataset?.vertical?.unit || null} track={section.track} />
  </div>;
}

export function DepthSliceView({ dataset, variableKey }) {
  const variable = fieldByKey(dataset, variableKey);
  const range = useMemo(() => depthRange(dataset), [dataset]);
  const [depth, setDepth] = useState(() => range ? (range.min + range.max) / 2 : 0);
  useEffect(() => { if (range) setDepth((range.min + range.max) / 2); }, [range?.min, range?.max]);
  const measurements = useMemo(() => range ? depthSliceMeasurements(dataset, variableKey, depth) : [], [dataset, variableKey, depth, range]);
  const grid = useMemo(() => interpolateBoundedGrid(measurements, { maxCells: 6000, maxSourcePoints: 1200, coordinateMode: 'geographic' }), [measurements]);
  if (!range) return <p className="viz-note" data-tone="warning">A true depth coordinate is required for depth slices.</p>;
  const step = Math.max(0.1, (range.max - range.min) / 100);
  const unit = dataset.vertical?.unit || '';
  return <div>
    <div className="viz-card mb-3 p-3">
      <div className="flex items-center justify-between text-xs"><span className="viz-label">Depth slice</span><span className="viz-num text-sm font-semibold viz-accent-text">{fmt(depth)} {unit}</span></div>
      <input className="viz-range mt-2" type="range" min={range.min} max={range.max} step={step} value={depth} onChange={(event) => setDepth(Number(event.target.value))} aria-label="Depth of the slice" />
      <div className="mt-1 flex justify-between text-[11px] viz-muted viz-num"><span>{fmt(range.min)} {unit}</span><span>{fmt(range.max)} {unit}</span></div>
    </div>
    <p className="viz-plot-meta"><span><strong className="viz-text">{measurements.length}</strong> casts have a measurement close to {fmt(depth)} {unit}; only those constrain the layer.</span></p>
    <SpatialGridSvg grid={grid} variable={variable} label={`Interpolated depth slice at ${fmt(depth)} ${unit}`} />
  </div>;
}

export function SurfaceLayerView({ dataset, variableKey }) {
  const variable = fieldByKey(dataset, variableKey);
  const measurements = useMemo(() => surfaceMeasurements(dataset, variableKey), [dataset, variableKey]);
  const grid = useMemo(() => interpolateBoundedGrid(measurements, { maxCells: 6000, maxSourcePoints: 1800, coordinateMode: 'geographic' }), [measurements]);
  return <div>
    <p className="viz-plot-meta"><span>Near-surface value = the shallowest valid observation at each cast or location. Measured points stay visible on top of the interpolated layer.</span></p>
    <SpatialGridSvg grid={grid} variable={variable} label="Interpolated near-surface scientific layer" />
  </div>;
}
