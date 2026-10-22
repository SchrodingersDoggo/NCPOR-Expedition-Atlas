import React, { useEffect, useMemo, useRef, useState } from 'react';
import { canonicalPreviewRows } from '../model.js';
import { COORDINATE_ROLES, validateMapping } from '../detection.js';
import '../ui/workbench.css';
import { variableLabel, variableName } from '../ui/labels.js';

const ROLE_LABELS = {
  lat: 'Latitude',
  lon: 'Longitude',
  depth: 'Depth',
  pressure: 'Pressure',
  time: 'Time',
  station: 'Station / cast',
};

const ROLE_HELP = {
  lat: 'Decimal degrees, −90 to 90',
  lon: 'Decimal degrees, −180 to 360',
  depth: 'Metres below the surface',
  pressure: 'dbar; kept as pressure, not converted',
  time: 'Date/time; offset-less times are read as UTC',
  station: 'Groups rows into casts',
};

function roleHint(role, detection, mapping, fields = []) {
  const detail = detection?.roleDetails?.[role];
  const ambiguous = (detection?.ambiguousRoles || []).includes(role);
  const current = mapping?.roles?.[role] || null;
  if (ambiguous) {
    const candidate = detail?.fieldKey ? fields.find((field) => field.key === detail.fieldKey) : null;
    return { tone: 'warning', text: candidate ? `Uncertain — best guess "${candidate.originalName}"` : 'Uncertain — please confirm' };
  }
  if (detail?.confidence === 'high' && current && current === detail.fieldKey) return { tone: 'success', text: 'Detected automatically' };
  return null;
}

export default function MappingDialog({ dataset, detection, initialMapping = null, onAccept, onCancel }) {
  const [mapping, setMapping] = useState(() => structuredClone(initialMapping || detection?.mapping || { roles: {}, fields: {} }));
  const [error, setError] = useState('');
  const preview = useMemo(() => canonicalPreviewRows(dataset, 20), [dataset]);
  const fields = dataset?.fields || [];
  const firstSelectRef = useRef(null);

  useEffect(() => {
    firstSelectRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const setRole = (role, fieldKey) => {
    setError('');
    setMapping((current) => ({ ...current, roles: { ...current.roles, [role]: fieldKey || null } }));
  };

  const setAction = (fieldKey, action) => {
    setMapping((current) => ({ ...current, fields: { ...current.fields, [fieldKey]: action } }));
  };

  const accept = () => {
    const result = validateMapping(dataset, mapping);
    if (!result.valid) {
      setError(result.errors.join(' '));
      return;
    }
    onAccept?.(mapping);
  };

  const coordinateKeys = new Set(Object.values(mapping.roles || {}).filter(Boolean));
  const otherFields = fields.filter((field) => !coordinateKeys.has(field.key));

  return (
    <div className="viz-dialog-backdrop" role="presentation">
      <div className="viz-dialog" role="dialog" aria-modal="true" aria-labelledby="viz-mapping-title">
        <div className="mb-5">
          <h2 id="viz-mapping-title" className="text-lg font-semibold viz-text">Confirm scientific data mapping</h2>
          <p className="mt-1 text-[13px] viz-text-2">Some columns could not be identified with confidence. The visualizer never guesses coordinates — confirm each role below. Your choice is remembered for this exact file version on this device.</p>
        </div>

        <h3 className="viz-panel-title">Coordinates</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COORDINATE_ROLES.map((role, index) => {
            const hint = roleHint(role, detection, mapping, fields);
            return <label key={role} className="viz-card block p-3">
              <span className="flex items-baseline justify-between gap-2"><span className="text-[13px] font-semibold viz-text">{ROLE_LABELS[role]}</span>{hint && <span className={`text-[11px] font-semibold ${hint.tone === 'warning' ? 'viz-warn-text' : 'viz-ok-text'}`}>{hint.text}</span>}</span>
              <span className="mt-0.5 block text-[11px] viz-muted">{ROLE_HELP[role]}</span>
              <select ref={index === 0 ? firstSelectRef : undefined} className="viz-select mt-2 w-full" value={mapping.roles?.[role] || ''} onChange={(event) => setRole(role, event.target.value)}>
                <option value="">Not mapped</option>
                {fields.map((field) => <option key={field.key} value={field.key}>{variableLabel(field, field.originalName)}</option>)}
              </select>
            </label>;
          })}
        </div>

        {otherFields.length > 0 && <div className="mt-6">
          <h3 className="viz-panel-title">Other columns</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {otherFields.map((field) => (
              <label key={field.key} className="viz-card flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-[13px] viz-text">{variableName(field)}{field.unit ? <span className="ml-1 text-[11px] viz-muted">({field.unit})</span> : null}</span>
                <select value={mapping.fields?.[field.key] || 'variable'} onChange={(event) => setAction(field.key, event.target.value)} className="viz-select" style={{ minWidth: 110 }}>
                  <option value="variable">Variable</option>
                  <option value="ignore">Ignore</option>
                </select>
              </label>
            ))}
          </div>
        </div>}

        <div className="mt-6">
          <h3 className="viz-panel-title mb-2">Preview (first {preview.length} records)</h3>
          <div className="viz-table-wrap" style={{ maxHeight: 280 }}>
            <table className="viz-table">
              <thead><tr>{fields.map((field) => <th key={field.key} data-numeric={field.type === 'number'}>{field.originalName}</th>)}</tr></thead>
              <tbody>{preview.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, colIndex) => <td key={fields[colIndex]?.key || colIndex} data-numeric={fields[colIndex]?.type === 'number'} data-missing={value == null}>{value == null ? '—' : String(value)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>

        {error ? <p className="viz-note mt-4" data-tone="danger" role="alert">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          {onCancel ? <button type="button" onClick={onCancel} className="viz-btn">Cancel</button> : null}
          <button type="button" onClick={accept} className="viz-btn viz-btn-primary">Use mapping</button>
        </div>
      </div>
    </div>
  );
}
