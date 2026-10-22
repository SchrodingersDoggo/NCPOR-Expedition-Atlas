export function createV6ProductLifecycle() {
  let generation = 0;
  let controller = null;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      generation += 1;
      return { generation, controller, signal: controller.signal };
    },
    cancel() {
      controller?.abort();
      generation += 1;
      controller = null;
      return generation;
    },
    isCurrent(candidate) {
      return candidate === generation;
    },
    currentGeneration() { return generation; },
  };
}
