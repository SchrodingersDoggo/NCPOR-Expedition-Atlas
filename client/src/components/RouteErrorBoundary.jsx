import React from 'react';
import { useLocation } from 'react-router-dom';

// Catches a rendering error in one page so it shows a message instead of
// blanking the whole app (navbar, sync badge and offline queue stay usable).
// Keyed by route path, so navigating elsewhere resets it automatically.
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunkFailed = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(String(error?.message || ''));
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6 py-12">
        <div className="max-w-2xl w-full rounded-xl border border-red-900/60 bg-red-950/20 p-6">
          <h1 className="text-lg font-semibold text-red-200">{chunkFailed ? 'This page is not available offline yet' : 'This page ran into a problem'}</h1>
          <p className="text-sm text-slate-300 mt-2">
            {chunkFailed
              ? 'Its code has not been downloaded to this device. Open it once while online and it will work offline afterwards. The rest of the app still works.'
              : 'The rest of the app is still working. You can go back or reload this page.'}
          </p>
          {!chunkFailed && <pre className="mt-4 max-h-60 overflow-auto rounded bg-black/40 p-3 text-xs text-red-200 whitespace-pre-wrap">{String(error?.message || error)}</pre>}
          <div className="mt-5 flex gap-3">
            <button type="button" onClick={() => window.history.back()} className="px-3 py-2 rounded-md border border-slate-600 text-slate-200 text-sm hover:bg-slate-800">Go back</button>
            <button type="button" onClick={() => window.location.reload()} className="px-3 py-2 rounded-md bg-cyan-700 hover:bg-cyan-600 text-white text-sm">Reload page</button>
          </div>
        </div>
      </div>
    );
  }
}

export default function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return <Boundary key={location.pathname}>{children}</Boundary>;
}
