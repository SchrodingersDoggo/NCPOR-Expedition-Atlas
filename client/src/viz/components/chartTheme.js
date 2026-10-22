// Shared Recharts styling for the dark visualization stage, so every 2D
// chart uses the same recessive grid, readable axis ink and tooltip.
export const CHART = Object.freeze({
  series: '#5598e7',
  seriesStrong: '#8fc0f5',
  highlight: '#f0a04b',
  muted: '#86a3b0',
  ink: '#e4f1f6',
  ink2: '#b3cad4',
  grid: 'rgba(134, 163, 176, 0.16)',
  axis: '#2a5165',
});

export const axisTick = Object.freeze({ fill: CHART.muted, fontSize: 11 });
export const axisLine = Object.freeze({ stroke: CHART.axis });

export const tooltipStyle = Object.freeze({
  contentStyle: { background: '#0c2130', border: '1px solid #2a5165', borderRadius: 8, color: CHART.ink, fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,.45)' },
  labelStyle: { color: CHART.ink2, marginBottom: 4 },
  itemStyle: { color: CHART.ink, padding: 0 },
  cursor: { stroke: 'rgba(143, 219, 238, 0.35)', strokeWidth: 1 },
});

export function axisLabel(value, { angle = 0, position = 'insideBottom', offset = -2 } = {}) {
  return { value, angle, position, offset, fill: CHART.ink2, fontSize: 12 };
}
