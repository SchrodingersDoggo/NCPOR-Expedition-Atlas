import React from 'react';

// Catches a failure to load the globe's lazy-loaded chunk (GlobeView.jsx +
// react-globe.gl/three). This specific failure mode didn't exist before the
// globe was code-split (Phase 4) — previously react-globe.gl/three were
// bundled directly into the page, always already present. Now that it's a
// separate dynamic import(), that import can outright reject if the device
// is offline and has never fetched that chunk before (e.g. someone whose
// very first visit is already offline, or who's always been on a tier that
// never loaded it). Texture-load failures inside the globe itself (missing
// cached image assets) are a different, older failure mode that three.js
// already tolerates gracefully on its own — this boundary is only for the
// chunk-load failure, which would otherwise crash the whole render tree.
export default class GlobeErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn('[NCPOR globe] failed to load, falling back to the list view', error);
    this.props.onError?.();
  }

  componentDidUpdate(prevProps) {
    // Give it a fresh attempt whenever resetKey changes (e.g. the network
    // tier changed) rather than staying permanently fallen-back for the
    // rest of the session.
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
