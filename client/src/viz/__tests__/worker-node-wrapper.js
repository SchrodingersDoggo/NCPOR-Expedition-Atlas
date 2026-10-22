import { parentPort } from 'node:worker_threads';

globalThis.self = {
  addEventListener(type, handler) {
    if (type === 'message') parentPort.on('message', (data) => handler({ data }));
  },
  postMessage(message, transfer = []) {
    parentPort.postMessage(message, transfer);
  },
};

await import('../worker/viz.worker.js');
