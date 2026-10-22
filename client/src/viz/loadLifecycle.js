// One controller/generation per visualizer load. Generation checks are kept in
// addition to AbortController because an async completion can race with abort
// delivery; stale work must never commit state for a newly selected dataset.
export function createLoadLifecycle() {
  let generation = 0;
  let controller = null;

  return {
    start() {
      controller?.abort();
      controller = new AbortController();
      generation += 1;
      const ownGeneration = generation;
      const ownSignal = controller.signal;
      return {
        generation: ownGeneration,
        signal: ownSignal,
        isCurrent: () => ownGeneration === generation && !ownSignal.aborted,
      };
    },

    cancel() {
      controller?.abort();
      controller = null;
      generation += 1;
    },

    currentGeneration() {
      return generation;
    },
  };
}

export function commitIfCurrent(load, callback) {
  if (!load?.isCurrent?.()) return false;
  callback();
  return true;
}
