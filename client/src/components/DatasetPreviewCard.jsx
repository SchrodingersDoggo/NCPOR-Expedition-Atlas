import React from 'react';
import { Database, X } from 'lucide-react';

const PREVIEW_ROWS = 8;

const TYPE_BADGE = {
  number: { label: 'Number', className: 'bg-cyan-950/50 text-cyan-300 border-cyan-800' },
  date: { label: 'Date', className: 'bg-amber-950/40 text-amber-300 border-amber-800' },
  text: { label: 'Text', className: 'bg-slate-800 text-slate-400 border-slate-700' },
};

/**
 * DatasetPreviewCard - Displays dataset metadata after a CSV/Excel/file upload
 * or manual table build. Rendered inside an already-bordered item card, so
 * this stays "flat" (a divider + padding) rather than nesting another
 * bordered box inside a box inside a box.
 *
 * Props:
 *  - columns: array of { name: string, type: string }
 *  - previewRows: array of arrays (first row values), max 8 rows shown
 *  - rowCount: number of total rows
 *  - onDelete: optional callback when user clicks to remove/clear
 */
function DatasetPreviewCard({
  columns,
  previewRows,
  rowCount,
  onDelete,
}) {
  return (
    <div className="mt-2 pt-4 border-t border-slate-700/70">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">
            Dataset preview
          </h3>
          <span className="text-xs text-slate-500">
            {rowCount} row{rowCount === 1 ? '' : 's'} · {columns.length} column{columns.length === 1 ? '' : 's'}
          </span>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="text-slate-500 hover:text-red-400 transition-colors"
            aria-label="Remove dataset preview"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Column chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {columns.map((col, i) => {
          const badge = TYPE_BADGE[col.type] || TYPE_BADGE.text;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-xs bg-slate-800/70 border border-slate-700 text-slate-300"
            >
              {col.name}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${badge.className}`}>
                {badge.label}
              </span>
            </span>
          );
        })}
      </div>

      {/* First N rows preview */}
      <div className="rounded-lg overflow-hidden border border-slate-700/70">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/80">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.name}
                    className="px-3 py-2 text-left font-semibold tracking-wider uppercase text-[10px] text-slate-400 whitespace-nowrap"
                  >
                    {col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {previewRows.slice(0, PREVIEW_ROWS).map((row, rIdx) => (
                <tr key={rIdx} className="even:bg-slate-800/40">
                  {row.map((cell, cIdx) => {
                    const value = cell !== null && cell !== undefined ? String(cell) : '';
                    return (
                      <td key={cIdx} className="px-3 py-2 text-slate-300 whitespace-nowrap">
                        {value || <span className="text-slate-600">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {rowCount > PREVIEW_ROWS && (
        <p className="mt-2 text-xs text-slate-500">
          Showing the first {PREVIEW_ROWS} of {rowCount} rows.
        </p>
      )}
    </div>
  );
}

export default DatasetPreviewCard;
