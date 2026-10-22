import { openDB } from 'idb';
import toast from 'react-hot-toast';
import { DB_NAME, DB_VERSION } from './constants.js';
import { upgradeOfflineDatabase } from './dbSchema.js';

// Opens (and, on first run, creates) the offline IndexedDB database.
// Deliberately a single shared promise — idb dedupes concurrent opens, but
// keeping one module-level handle means every caller in the app talks to
// the same connection instead of re-opening it per call.
let dbPromise = null;

const BLOCKED_TOAST_ID = 'ncpor-offline-db-blocked';
const BLOCKING_TOAST_ID = 'ncpor-offline-db-blocking';

function notify(id, message) {
  try {
    toast(message, { id, duration: 12000, icon: '⚠️' });
  } catch {
    // Toasts are a convenience only; storage behaviour must not depend on them.
  }
  console.warn(message);
}

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        upgradeOfflineDatabase(db);
      },
      // Another tab still holds the database at an older version, so this
      // upgrade cannot start. The open simply waits (nothing is lost) and
      // continues by itself as soon as the other tab closes or reloads.
      blocked() {
        notify(
          BLOCKED_TOAST_ID,
          'Offline storage is being updated. Close or reload other NCPOR tabs to finish — your saved and queued data is safe.'
        );
      },
      // A newer version of the app opened in another tab wants to upgrade the
      // database. Close this connection so that upgrade is not stuck behind
      // this tab; this tab then needs a reload to use the updated storage.
      blocking() {
        dbPromise?.then((db) => db.close()).catch(() => {});
        dbPromise = null;
        notify(
          BLOCKING_TOAST_ID,
          'NCPOR was updated in another tab. Reload this tab to keep using offline storage.'
        );
      },
    });
    // Never cache a failed open: a later call should be able to retry.
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}
