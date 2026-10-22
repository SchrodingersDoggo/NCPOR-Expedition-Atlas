import { useCallback, useEffect, useState } from 'react';

// SVG plots are drawn in their container's real pixel width, so axis labels
// keep a readable size on phones instead of shrinking with a fixed viewBox.
// A callback ref is used so measuring starts whenever the plot element
// appears (plots can mount after an empty/loading state).
export function usePlotSize({ aspect = 0.56, minWidth = 320, maxWidth = 1400, minHeight = 280 } = {}) {
  const [element, setElement] = useState(null);
  const [width, setWidth] = useState(1000);
  const ref = useCallback((node) => setElement(node), []);

  useEffect(() => {
    if (!element) return undefined;
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width || element.clientWidth || 0);
      if (next > 0) setWidth((current) => (Math.abs(current - next) > 2 ? next : current));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const w = Math.max(minWidth, Math.min(maxWidth, width));
  const h = Math.max(minHeight, Math.round(w * aspect));
  return { ref, width: w, height: h, compact: w < 560 };
}
