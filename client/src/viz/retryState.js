// V3.2 keeps retry/reload decisions separate from dataset loading itself.
// A retry always goes back through VizPage.loadSelected(false, selected), so
// the existing offline, low-bandwidth and browser-size safeguards remain the
// single source of truth.
const RESTARTABLE_STATUSES = new Set(['idle', 'error', 'cancelled', 'offline-blocked']);

export function canRestartVisualization(status) {
  return RESTARTABLE_STATUSES.has(status);
}

export function canUseRetryAction(status, { isOffline = false } = {}) {
  if (!canRestartVisualization(status)) return false;
  if (status === 'offline-blocked' && isOffline) return false;
  return true;
}

export function retryMessage(status, { isOffline = false } = {}) {
  if (status === 'cancelled') return 'Visualization loading was cancelled.';
  if (status === 'offline-blocked') {
    return isOffline
      ? 'This dataset is not saved offline on this device. Retry will be available when the connection returns.'
      : 'Connection restored. You can retry visualization without changing datasets.';
  }
  if (status === 'error') return 'The previous visualization attempt failed. You can retry the same dataset.';
  if (status === 'idle') return 'This dataset is selected and ready to load.';
  return '';
}
