import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { boundedScatterSample, minMaxDownsample, tablePage } from '../sampling.js';
import { profileSeries } from '../profileSeries.js';
import { buildMapModel } from '../mapModel.js';
import { createColorScale, niceTicks, NO_DATA_COLOR, paletteForVariable, scaleSwatchColor } from '../colorScale.js';
import { axisLabel, axisLine, axisTick, CHART, tooltipStyle } from './chartTheme.js';
import ColorLegend from './ColorLegend.jsx';
import { usePlotSize } from './plotSize.js';
import { variableName } from '../ui/labels.js';

function fieldByKey(dataset, key) {
  return key ? (dataset?.fields || []).find((field) => field.key === key) || null : null;
}

function fmt(value) {
  if (value == null || Number.isNaN(value)) return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 1e5 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)) return value.toExponential(3);
    return Number(value.toPrecision(6)).toString();
  }
  return String(value);
}

function withUnit(name, unit) {
  return unit ? `${name} (${unit})` : name;
}

const nameOf = (field, fallback) => variableName(field) || fallback;

// Times are shown in UTC so every viewer sees the same instant; the
// normalization step already interprets offset-less times as UTC.
function utcLabel(value, { withTime = true } = {}) {
  const d = new Date(Number(value));
  if (!Number.isFinite(d.getTime())) return fmt(value);
  const iso = d.toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso.slice(0, 10);
}

function ChartFrame({ children, height = 440 }) {
  return <div className="viz-plot px-2 pt-3" style={{ height }}>{children}</div>;
}

// ---------------------------------------------------------------- table
export function DataTableView({ dataset }) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [dataset]);
  const result = useMemo(() => tablePage(dataset, page, 100), [dataset, page]);
  const fields = dataset?.fields || [];
  return (
    <div>
      <div className="viz-table-wrap">
        <table className="viz-table">
          <thead><tr>{fields.map((field) => <th key={field.key} data-numeric={field.type === 'number'}>{nameOf(field, field.originalName)}{field.unit ? <span className="viz-unit"> ({field.unit})</span> : null}</th>)}</tr></thead>
          <tbody>{result.rows.map((row, rowOffset) => <tr key={result.start + rowOffset}>{row.map((value, col) => {
            const numeric = fields[col]?.type === 'number';
            const missing = value == null || (typeof value === 'number' && !Number.isFinite(value));
            return <td key={`${rowOffset}-${fields[col]?.key || col}`} data-numeric={numeric} data-missing={missing}>{missing ? '—' : fmt(value)}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs viz-muted">
        <span>{result.totalRows ? <>Rows <span className="viz-num viz-text-2">{(result.start + 1).toLocaleString()}–{result.end.toLocaleString()}</span> of <span className="viz-num viz-text-2">{result.totalRows.toLocaleString()}</span></> : 'No rows'}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(0)} disabled={result.page === 0} className="viz-btn viz-btn-sm">First</button>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={result.page === 0} className="viz-btn viz-btn-sm">Previous</button>
          <span className="viz-num">Page {result.page + 1} / {result.pageCount}</span>
          <button onClick={() => setPage((p) => Math.min(result.pageCount - 1, p + 1))} disabled={result.page >= result.pageCount - 1} className="viz-btn viz-btn-sm">Next</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- histogram
export function HistogramView({ dataset, variableKey }) {
  const field = fieldByKey(dataset, variableKey);
  const data = (field?.statistics?.histogram?.bins || []).map((bin) => ({
    range: `${fmt(bin.x0)} – ${fmt(bin.x1)}`,
    midpoint: (bin.x0 + bin.x1) / 2,
    count: bin.count,
  }));
  if (!data.length) return <p className="text-sm viz-muted">No finite values are available for a histogram.</p>;
  const total = data.reduce((sum, bin) => sum + bin.count, 0);
  return <div>
    <ChartFrame><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 8, right: 16, bottom: 26, left: 8 }} barCategoryGap={1}>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis dataKey="midpoint" tickFormatter={fmt} minTickGap={28} tick={axisTick} axisLine={axisLine} tickLine={false} label={axisLabel(withUnit(nameOf(field, 'Value'), field?.unit), { offset: -14 })} />
      <YAxis tick={axisTick} axisLine={false} tickLine={false} width={54} allowDecimals={false} />
      <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(143, 219, 238, 0.08)' }} labelFormatter={(_, payload) => payload?.[0]?.payload?.range || ''} formatter={(value) => [Number(value).toLocaleString(), 'Observations']} />
      <Bar dataKey="count" fill={CHART.series} radius={[3, 3, 0, 0]} isAnimationActive={false} />
    </BarChart></ResponsiveContainer></ChartFrame>
    <p className="viz-plot-caption">{total.toLocaleString()} valid observations in {data.length} bins.</p>
  </div>;
}

// ---------------------------------------------------------------- scatter
export function ScatterView({ dataset, xKey, yKey }) {
  const x = fieldByKey(dataset, xKey);
  const y = fieldByKey(dataset, yKey);
  const data = useMemo(() => boundedScatterSample(x?.values, y?.values, 5000), [x?.values, y?.values]);
  const same = xKey && xKey === yKey;
  return (
    <div>
      {same && <p className="viz-note mb-3" data-tone="info">X and Y are the same variable. Choose a different Y variable below to compare two measurements.</p>}
      <ChartFrame height={460}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 8, right: 16, bottom: 26, left: 8 }}>
        <CartesianGrid stroke={CHART.grid} />
        <XAxis type="number" dataKey="x" name={nameOf(x, 'X')} tickFormatter={fmt} domain={['auto', 'auto']} tick={axisTick} axisLine={axisLine} tickLine={false} label={axisLabel(withUnit(nameOf(x, 'X'), x?.unit), { offset: -14 })} />
        <YAxis type="number" dataKey="y" name={nameOf(y, 'Y')} tickFormatter={fmt} domain={['auto', 'auto']} tick={axisTick} axisLine={axisLine} tickLine={false} width={64} label={axisLabel(withUnit(nameOf(y, 'Y'), y?.unit), { angle: -90, position: 'insideLeft', offset: 10 })} />
        <ZAxis range={[16, 16]} />
        <Tooltip {...tooltipStyle} formatter={(value, name) => [fmt(value), name]} />
        <Scatter data={data} fill={CHART.series} fillOpacity={0.55} isAnimationActive={false} />
      </ScatterChart></ResponsiveContainer></ChartFrame>
      <p className="viz-plot-caption">{data.length.toLocaleString()} points shown{data.length < Math.min(x?.statistics?.count || 0, y?.statistics?.count || 0) ? ` (evenly sampled from ${Math.min(x?.statistics?.count || 0, y?.statistics?.count || 0).toLocaleString()} valid observations)` : ''}.</p>
    </div>
  );
}

// ---------------------------------------------------------------- time series
export function SeriesView({ dataset, xValues, variableKey, xLabel, reverseY = false, formatTime = false }) {
  const variable = fieldByKey(dataset, variableKey);
  const data = useMemo(() => minMaxDownsample(xValues, variable?.values, 4000), [xValues, variable?.values]);
  const span = data.length ? data[data.length - 1].x - data[0].x : 0;
  const shortSpan = formatTime && span > 0 && span < 2 * 86400000;
  const axisFormatter = formatTime
    ? (value) => {
      const d = new Date(Number(value));
      if (!Number.isFinite(d.getTime())) return fmt(value);
      return shortSpan ? d.toISOString().slice(11, 16) : d.toISOString().slice(0, 10);
    }
    : fmt;
  return (
    <div>
      <ChartFrame height={460}><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 16, bottom: 26, left: 8 }}>
        <CartesianGrid stroke={CHART.grid} />
        <XAxis dataKey="x" type="number" tickFormatter={axisFormatter} domain={['dataMin', 'dataMax']} minTickGap={36} tick={axisTick} axisLine={axisLine} tickLine={false} label={axisLabel(formatTime ? `${xLabel} (UTC)` : xLabel, { offset: -14 })} />
        <YAxis dataKey="y" type="number" tickFormatter={fmt} reversed={reverseY} domain={['auto', 'auto']} tick={axisTick} axisLine={axisLine} tickLine={false} width={64} label={axisLabel(withUnit(nameOf(variable, 'Value'), variable?.unit), { angle: -90, position: 'insideLeft', offset: 10 })} />
        <Tooltip {...tooltipStyle} labelFormatter={(value) => (formatTime ? utcLabel(value) : fmt(value))} formatter={(value) => [fmt(value), withUnit(nameOf(variable, 'Value'), variable?.unit)]} />
        <Line type="linear" dataKey="y" dot={false} stroke={CHART.series} strokeWidth={1.6} isAnimationActive={false} />
      </LineChart></ResponsiveContainer></ChartFrame>
      <p className="viz-plot-caption">{data.length.toLocaleString()} points drawn · min/max binning keeps every local peak and trough visible.</p>
    </div>
  );
}

// ---------------------------------------------------------------- vertical profile
function ProfileTooltip({ active, payload, verticalLabel, verticalUnit, variable }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return <div style={tooltipStyle.contentStyle} className="px-3 py-2">
    <div style={tooltipStyle.labelStyle}>{point.cast}</div>
    <div>{withUnit(nameOf(variable, 'Value'), variable?.unit)}: <strong>{fmt(point.x)}</strong></div>
    <div>{withUnit(verticalLabel, verticalUnit)}: <strong>{fmt(point.y)}</strong></div>
  </div>;
}

export function ProfileView({ dataset, verticalValues, variableKey, verticalLabel }) {
  const variable = fieldByKey(dataset, variableKey);
  const [focus, setFocus] = useState('all');
  const profiles = useMemo(() => profileSeries(dataset, verticalValues, variable?.values, { maxPoints: 4000 }), [dataset, verticalValues, variable?.values]);
  useEffect(() => { setFocus('all'); }, [dataset]);
  const multi = profiles.series.length > 1;
  const verticalUnit = dataset?.vertical?.unit || null;
  const series = profiles.series.map((item) => ({
    ...item,
    data: item.points.map((point) => ({ x: point.y, y: point.x, cast: item.label })),
  }));
  const focused = multi && focus !== 'all' ? series.find((item) => item.id === focus) : null;
  const ordered = focused ? [...series.filter((item) => item !== focused), focused] : series;
  const pointCount = series.reduce((sum, item) => sum + item.data.length, 0);

  if (!series.length) return <p className="text-sm viz-muted">No paired {verticalLabel.toLowerCase()} and variable values are available for a profile.</p>;
  return (
    <div>
      {multi && <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="viz-label flex items-center gap-2">Cast<select value={focus} onChange={(event) => setFocus(event.target.value)} className="viz-select">
          <option value="all">All {profiles.castCount} casts (overlay)</option>
          {series.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <span className="viz-muted">Each cast is drawn as its own line — lines are never joined across stations.</span>
      </div>}
      <ChartFrame height={500}><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 8, right: 16, bottom: 26, left: 8 }}>
        <CartesianGrid stroke={CHART.grid} />
        <XAxis dataKey="x" type="number" tickFormatter={fmt} domain={['auto', 'auto']} tick={axisTick} axisLine={axisLine} tickLine={false} label={axisLabel(withUnit(nameOf(variable, 'Value'), variable?.unit), { offset: -14 })} />
        <YAxis dataKey="y" type="number" tickFormatter={fmt} reversed domain={['dataMin', 'dataMax']} tick={axisTick} axisLine={axisLine} tickLine={false} width={64} label={axisLabel(`${withUnit(verticalLabel, verticalUnit)} ↓`, { angle: -90, position: 'insideLeft', offset: 10 })} />
        <ZAxis range={[10, 10]} />
        <Tooltip content={<ProfileTooltip verticalLabel={verticalLabel} verticalUnit={verticalUnit} variable={variable} />} cursor={tooltipStyle.cursor} />
        {ordered.map((item) => {
          const isFocused = focused && item === focused;
          const dimmed = focused && !isFocused;
          const color = isFocused ? CHART.highlight : CHART.series;
          return <Scatter
            key={item.id}
            name={item.label}
            data={item.data}
            fill={color}
            fillOpacity={dimmed ? 0.18 : 0.9}
            line={{ stroke: color, strokeWidth: isFocused ? 2.2 : multi ? 1.2 : 1.8, strokeOpacity: dimmed ? 0.25 : 0.85 }}
            lineJointType="linear"
            shape={(props) => <circle cx={props.cx} cy={props.cy} r={isFocused || !multi ? 2 : 1.2} fill={color} fillOpacity={dimmed ? 0.18 : 0.9} />}
            isAnimationActive={false}
          />;
        })}
      </ScatterChart></ResponsiveContainer></ChartFrame>
      <p className="viz-plot-caption">
        {multi ? `${series.length} of ${profiles.castCount} casts shown${profiles.truncated ? ' (first casts only — pick one above to inspect it)' : ''}` : 'Single profile'} · {pointCount.toLocaleString()} points · {verticalLabel.toLowerCase()} increases downward · min/max binning keeps profile extrema.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- map
function niceKm(target) {
  if (!(target > 0)) return 1;
  const exponent = 10 ** Math.floor(Math.log10(target));
  const fraction = target / exponent;
  return (fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1) * exponent;
}

const MAP_MARGIN = { left: 70, right: 18, top: 16, bottom: 40 };
const MAP_MARGIN_COMPACT = { left: 52, right: 10, top: 12, bottom: 34 };

export function MapView({ dataset, variableKey }) {
  const model = useMemo(() => buildMapModel(dataset, variableKey), [dataset, variableKey]);
  const variable = model.variable || fieldByKey(dataset, variableKey);
  const scale = useMemo(() => createColorScale(model.points.map((point) => point.value), { palette: paletteForVariable(variable) }), [model, variable]);
  const plot = usePlotSize({ aspect: 0.56, minHeight: 300 });

  if (!model.points.length) return <p className="text-sm viz-muted">No valid paired latitude/longitude positions are available for this map.</p>;
  const MAP_W = plot.width;
  const MAP_H = plot.height;
  const margin = plot.compact ? MAP_MARGIN_COMPACT : MAP_MARGIN;

  const innerW = MAP_W - margin.left - margin.right;
  const innerH = MAP_H - margin.top - margin.bottom;
  const { minX, maxX, minY, maxY } = model.bounds;
  const kmPerPixel = Math.max((maxX - minX) / innerW, (maxY - minY) / innerH);
  const offsetX = margin.left + (innerW - (maxX - minX) / kmPerPixel) / 2;
  const offsetY = margin.top + (innerH - (maxY - minY) / kmPerPixel) / 2;
  const sx = (x) => offsetX + (x - minX) / kmPerPixel;
  const sy = (y) => offsetY + (maxY - y) / kmPerPixel;
  const frame = { x0: sx(minX), x1: sx(maxX), y0: sy(maxY), y1: sy(minY) };
  const barKm = niceKm((maxX - minX) * 0.22);
  const barPx = barKm / kmPerPixel;
  const labelled = model.mode === 'casts' && model.points.length <= (plot.compact ? 6 : 14);
  const hasValues = scale.kind !== 'empty';
  const unit = variable?.unit || '';

  const radius = (point) => (point.kind === 'cell' ? Math.min(6, 3 + Math.log2(Math.max(1, point.count)) * 0.5) : model.mode === 'casts' ? 7 : 4);

  return (
    <div>
      <div className="viz-plot" ref={plot.ref}>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} width="100%" className="block w-full" role="img" aria-label={`Map of ${model.points.length} ${model.mode === 'casts' ? 'cast positions' : 'observation positions'}`}>
          <rect x={frame.x0} y={frame.y0} width={frame.x1 - frame.x0} height={frame.y1 - frame.y0} fill="#081a24" stroke="#2a5165" />
          {model.latTicks.map((tick) => <g key={`lat-${tick.value}`}>
            <line x1={frame.x0} x2={frame.x1} y1={sy(tick.y)} y2={sy(tick.y)} stroke="rgba(134,163,176,0.16)" />
            <text x={frame.x0 - 8} y={sy(tick.y) + 4} textAnchor="end" fontSize="12" fill="#86a3b0">{tick.label}</text>
          </g>)}
          {model.lonTicks.map((tick) => <g key={`lon-${tick.value}`}>
            <line x1={sx(tick.x)} x2={sx(tick.x)} y1={frame.y0} y2={frame.y1} stroke="rgba(134,163,176,0.16)" />
            <text x={sx(tick.x)} y={frame.y1 + 18} textAnchor="middle" fontSize="12" fill="#86a3b0">{tick.label}</text>
          </g>)}
          {model.points.map((point, index) => {
            const cx = sx(point.x);
            const cy = sy(point.y);
            const r = radius(point);
            const valueKnown = Number.isFinite(point.value);
            return <g key={`${point.kind}-${index}`}>
              <circle cx={cx} cy={cy} r={r} fill={valueKnown ? scale.color(point.value) : 'transparent'} stroke={valueKnown ? '#06121a' : NO_DATA_COLOR} strokeWidth={valueKnown ? 1.5 : 1.5}>
                <title>{[
                  point.label,
                  `${point.lat.toFixed(4)}°, ${point.lon.toFixed(4)}°`,
                  valueKnown ? `${nameOf(variable, 'Value')}: ${fmt(point.value)}${unit ? ` ${unit}` : ''}${model.surfaceOnly && point.vertical != null ? ` (shallowest, ${fmt(point.vertical)} ${dataset?.vertical?.unit || ''})` : ''}` : 'No value for the selected variable',
                  point.kind === 'cell' ? `${point.count.toLocaleString()} observations averaged` : null,
                ].filter(Boolean).join('\n')}</title>
              </circle>
              {labelled && <text x={cx + r + 5} y={cy + 4} fontSize="12" fill="#e4f1f6" stroke="#06121a" strokeWidth="3" paintOrder="stroke">{point.label}</text>}
            </g>;
          })}
          <g transform={`translate(${frame.x1 - barPx - 14}, ${frame.y1 - 16})`}>
            <line x1="0" x2={barPx} y1="0" y2="0" stroke="#e4f1f6" strokeWidth="2" />
            <line x1="0" x2="0" y1="-4" y2="4" stroke="#e4f1f6" strokeWidth="2" />
            <line x1={barPx} x2={barPx} y1="-4" y2="4" stroke="#e4f1f6" strokeWidth="2" />
            <text x={barPx / 2} y="-8" textAnchor="middle" fontSize="11" fill="#e4f1f6" stroke="#06121a" strokeWidth="3" paintOrder="stroke">{barKm >= 1 ? `${barKm} km` : `${barKm * 1000} m`}</text>
          </g>
        </svg>
      </div>
      <ColorLegend
        scale={hasValues ? scale : null}
        label={nameOf(variable, 'Value')}
        unit={unit}
        keys={[
          { label: model.mode === 'casts' ? 'Cast / station position' : model.aggregated ? 'Grid cell (mean of observations)' : 'Observation', color: hasValues ? scaleSwatchColor(scale) : 'transparent', stroke: '#06121a' },
          ...(model.points.some((point) => !Number.isFinite(point.value)) ? [{ label: 'No value for this variable', color: 'transparent', stroke: NO_DATA_COLOR }] : []),
        ]}
      />
      <p className="viz-plot-caption">
        {model.points.length.toLocaleString()} {model.mode === 'casts' ? 'casts' : model.aggregated ? 'grid cells' : 'observations'}
        {model.surfaceOnly ? ' · colour shows the shallowest measurement at each location, so surface and deep water are never mixed' : ''}
        {model.aggregated ? ' · dense positions are averaged on a grid fitted to the data extent' : ''}
        {' · local projection fitted to the data (no basemap, works offline).'}
      </p>
    </div>
  );
}

// Re-exported for legacy imports.
export { niceTicks };
