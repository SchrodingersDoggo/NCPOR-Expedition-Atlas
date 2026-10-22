import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { WORKBENCH_VIEW_GROUPS } from './workbenchModel.js';

// Unavailable views stay visible (so users learn what the data could support)
// but use aria-disabled instead of the disabled attribute: disabled buttons
// cannot receive focus or clicks, so their tooltip never appears on touch
// screens or with a keyboard. Choosing one explains why it is unavailable.
export default function ViewModeBar({ views = [], activeView, capabilityForView, onSelect }) {
  const byKey = new Map(views.map((view) => [view[0], view]));
  const [explained, setExplained] = useState(null);
  useEffect(() => { setExplained(null); }, [activeView]);

  const groups = WORKBENCH_VIEW_GROUPS
    .map((group) => ({ ...group, items: group.views.map((key) => byKey.get(key)).filter(Boolean) }))
    .filter((group) => group.items.length);

  return <div className="viz-toolbar">
    <div className="viz-toolbar-scroll flex gap-5 pb-1" role="toolbar" aria-label="Visualization views">
      {groups.map((group) => <div key={group.key} className="shrink-0" role="group" aria-label={group.label}>
        <div className="viz-group-label">{group.label}</div>
        <div className="flex gap-1.5">
          {group.items.map(([key, label, Icon]) => {
            const capability = capabilityForView(key) || { enabled: false, reason: 'Unavailable for this dataset.' };
            const active = activeView === key;
            const reason = capability.reason || 'Unavailable for this dataset.';
            return <button
              key={key}
              type="button"
              className="viz-mode-button"
              data-active={active}
              aria-pressed={active}
              aria-disabled={!capability.enabled}
              title={capability.enabled ? label : `${label} — ${reason}`}
              onClick={() => {
                if (capability.enabled) { setExplained(null); onSelect(key); }
                else setExplained({ label, reason });
              }}
            ><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</button>;
          })}
        </div>
      </div>)}
    </div>
    {explained && <p className="viz-note mt-2 flex items-start gap-2" data-tone="info" role="status"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span><strong>{explained.label}</strong> is not available for this dataset: {explained.reason}</span></p>}
  </div>;
}
