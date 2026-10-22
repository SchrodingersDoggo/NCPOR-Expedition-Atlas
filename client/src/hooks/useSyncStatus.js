import { useCallback, useEffect, useState } from 'react';
import { listPendingExpeditions, listPendingContent } from '../offline/queue.js';
import { onQueueChanged, onSyncState } from '../offline/syncChannel.js';
import { QUEUE_STATUS } from '../offline/constants.js';
import { getSyncState } from '../offline/syncManager.js';
import { getStorageEstimate, STORAGE_WARN_RATIO } from '../offline/storage.js';

// Read-only view onto the offline queue. Phase 7 adds three things the UI
// needs in order to never leave a researcher guessing:
//
//   blockReason — why the *run* is stalled (expired session, no connection,
//                 device full), which is different from why one item failed;
//   progress    — live bytes of the upload in flight, so a 90MB video looks
//                 like it is moving instead of frozen;
//   storage     — how close this device is to full, before it matters.
export function useSyncStatus() {
  const [state, setState] = useState({
    loading: true,
    expeditions: [],
    content: [],
  });
  const [runState, setRunState] = useState(() => getSyncState());
  const [storage, setStorage] = useState(null);

  const refresh = useCallback(async () => {
    const [expeditions, content] = await Promise.all([
      listPendingExpeditions(),
      listPendingContent(),
    ]);
    setState({ loading: false, expeditions, content });
  }, []);

  const refreshStorage = useCallback(async () => {
    setStorage(await getStorageEstimate());
  }, []);

  useEffect(() => {
    refresh();
    refreshStorage();
    const unsubscribeQueue = onQueueChanged(() => {
      refresh();
      refreshStorage();
    });
    const unsubscribeState = onSyncState(setRunState);
    return () => {
      unsubscribeQueue();
      unsubscribeState();
    };
  }, [refresh, refreshStorage]);

  const all = [...state.expeditions, ...state.content];
  const counts = {
    queued: all.filter((i) => i.status === QUEUE_STATUS.QUEUED).length,
    uploading: all.filter((i) => i.status === QUEUE_STATUS.UPLOADING).length,
    synced: all.filter((i) => i.status === QUEUE_STATUS.SYNCED).length,
    failed: all.filter((i) => i.status === QUEUE_STATUS.FAILED).length,
    // Items a human has to deal with: permanently failed, or conflicting.
    attention: all.filter((i) => i.needsAttention).length,
    total: all.length,
  };

  return {
    ...state,
    counts,
    refresh,
    storage,
    storageLow: storage?.ratio != null && storage.ratio >= STORAGE_WARN_RATIO,
    blockReason: runState.blockReason,
    syncing: runState.syncing,
    progress: runState.progress,
  };
}
