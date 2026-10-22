# NCPOR Expedition Atlas

## Phase 6 — Offline Application / PWA

The client now includes a small manual service worker for offline application-shell support.

- `client/public/sw.js` caches the SPA shell and same-origin application assets.
- SPA navigations use network-first with a cached `index.html` fallback, so routes such as `/upload` and `/sync` can reopen without internet after the app has been visited online.
- API requests are deliberately not cached; expedition/content data continues to use the existing IndexedDB queue and Phase 3A–5 synchronization flow.
- Existing third-party globe images are runtime-cached as image responses when they are successfully loaded online.
- `client/src/offline/registerServiceWorker.js` registers the worker only in production, avoiding service-worker interference during Vite development.
- `manifest.webmanifest` provides the PWA application metadata.

### Testing Phase 6

Build and serve the production client:

```bash
cd client
npm install
npm run build
npm run preview
```

Open the preview URL once while online. Then in browser DevTools:

1. Application → Service Workers: confirm `sw.js` is activated.
2. Application → Cache Storage: confirm the NCPOR shell/runtime caches exist.
3. Switch Network to Offline.
4. Refresh `/upload` or `/sync` directly. The SPA shell should reopen without the network.
5. Open the Upload page and verify the existing IndexedDB/offline queue still works. API requests must not be served from the service-worker cache.

The service worker is intentionally limited to Phase 6. It does not add background sync, conflict resolution, Sync Center changes, or later-phase features.

---

## Phase 7 — Error & Conflict Handling

Phase 3C could only ask "is this failure temporary?" and treated every other
outcome as permanent. Phase 7 replaces that single boolean with a
classification in `client/src/offline/errors.js` that answers three separate
questions per failure: may this be retried at all, does it count against the
retry limit, and should the whole run stop.

| Situation | Before | Now |
|---|---|---|
| Internet drops mid-sync | Retry attempt consumed; long browser timeout | Run halts, request aborted, **no attempt consumed**, item stays queued |
| Server 5xx / 429 | Retried every 30s poll | Exponential backoff with jitter, `Retry-After` honoured, still capped at 5 attempts |
| Session expired (401) | Item marked **failed** permanently | Run pauses with "sign in to sync"; resumes automatically on login, nothing lost |
| Insufficient permission (403) | Retried as if temporary | Failed immediately with a readable reason — retrying identical bytes cannot help |
| Duplicate request | Server idempotency (Phase 4) | Unchanged, plus the upload step is no longer repeated (see below) |
| Device out of space | Opaque "Submission failed" | Checked before writing; `OfflineStorageError` with a real message; queue never half-writes |
| Conflicting edits | Last write wins silently | `409` from the server with its current copy; surfaced in the Sync Center |
| Large files / videos | Rejected at sync time, days later | Rejected at file-pick time against the same rules the server enforces |

### Key behaviours

- **Uploads are not repeated.** The Cloudinary result is written to the queue
  record the moment it arrives, while the item still holds its sync claim. If
  `POST /content` then fails, the retry resumes from the metadata step instead
  of re-sending the file. This matters most for the 90MB video on a satellite
  link that the old code would have re-uploaded from zero.
- **Connectivity never burns retries.** Only failures the server actually
  produced count toward `MAX_ATTEMPTS`, so a week of bad weather cannot push
  good work into a permanent failed state.
- **Storage is defended at both ends.** `navigator.storage.persist()` is
  requested at startup so the browser will not evict the queue, and
  `ensureSpaceFor()` refuses a file that plainly will not fit before any
  partial write happens.
- **Synced blobs are released, records are not.** Once an item is confirmed on
  the server its local Blob is dropped to free space; the queue record (title,
  size, remote id, timestamps) stays visible in the Sync Center. Clearing those
  records is an explicit button, never automatic.
- **Nothing silently disappears.** No item reaches `synced` without a
  successful backend response; no local file or queue row is deleted on
  failure; every stalled state has a stated reason in the UI.

### Conflicting edits

`PATCH /api/expeditions/:id` now accepts `expected_updated_at` — the version
the edit was based on. If the server's `updated_at` has moved on, it responds
`409` with its current copy rather than overwriting whoever got there first.
`updateExpedition()` in `client/src/api/expeditions.js` sends it, and the Sync
Center renders a conflict item distinctly with the server's version timestamp.

Note the scope: this is the conflict *mechanism*. The portal does not yet queue
offline **edits** to existing expeditions (only creates and new content), so no
current UI flow generates a 409 on its own — it is reachable by PATCHing the
same expedition from two clients. Wiring an offline edit queue on top of this
belongs with the Phase 8 end-to-end scenario.

This phase requires a migration for the new column:

```bash
cd server
npx prisma migrate dev
```

### Testing Phase 7

Each of these should leave the queue intact and the reason visible:

1. **Drop mid-sync** — queue a large file, start syncing, set DevTools Network
   to Offline. Item returns to pending, attempt count does *not* increase.
2. **Server error** — stop the backend, trigger a sync. Items stay queued with
   a growing "next try in …" delay, and go to `failed` only after 5 attempts.
3. **Session expiry** — in DevTools Application → Local Storage, replace
   `ncpor_token` with a junk string and sync. The navbar shows "Sign in to
   sync", not failures; log in again and the queue drains by itself.
4. **Duplicate protection** — queue an item, throttle the network so the
   response is lost, let it retry. The server returns the original record;
   check there is exactly one row in `content_items`.
5. **Large file** — pick a file over 100MB, or an unsupported type. It is
   refused on selection with the reason, and never enters the queue.
6. **Storage** — the Sync Center's storage bar shows usage and turns red past
   80%. (To force the error path, queue files until the origin quota is hit in
   an incognito window, where quotas are much smaller.)
7. **Conflict** — `PATCH` an expedition twice from two clients, passing a stale
   `expected_updated_at` on the second. Expect `409` with the server's copy.


## Phase 8 — Full Offline Field Session

Phase 8 wires the final field-session behaviour on top of Phases 1–7:

- A researcher can open an expedition while online; its server copy is cached in IndexedDB.
- The expedition editor can reopen that cached copy while offline.
- Saving an edit always writes a durable local queue record first.
- When connectivity returns, the queued edit is PATCHed with `expected_updated_at`.
- A stale edit becomes a visible `409` conflict instead of silently overwriting the server copy.
- PATCH retries are idempotent through `client_request_id` / `last_edit_request_id`, so a lost response does not create a second logical edit.
- Existing reports, PDFs, photos, datasets and videos continue through the existing queue and expedition dependency ordering.

### End-to-end field test

1. Log in while online and open an expedition from the Atlas.
2. Open **Edit**, then switch DevTools Network to **Offline**.
3. Change the expedition description/name and press **Save changes**. The page should confirm the edit was saved locally.
4. Open **Sync Center**. The expedition edit must be `Pending`; no data should disappear.
5. While still offline, use Upload to create a report, select a PDF, add a photo and queue a dataset. Everything should remain locally queued.
6. Switch Network back to **Online**. The queue should process the expedition edit first, then dependent content.
7. Confirm the backend contains the updated expedition and all content items, with no duplicate content rows.
8. For conflict testing, edit the same expedition from another client after the offline copy was saved. When the offline edit syncs, expect `409`, `Conflict` in Sync Center, and the server copy preserved.
9. Refresh/reopen the app and verify synced queue records remain visible while unsynced records remain recoverable.

## Phase 3 — Lightweight Styling

Implemented only the styling-adaptation phase.

Changed files:
- `client/src/App.jsx`
- `client/src/index.css`
- `client/src/pages/LandingPage.jsx`

Behavior:
- **Fast**: no Phase 3 overrides; existing visuals remain unchanged.
- **Medium**: reduces decorative gradients/shadows, shortens transitions, simplifies backdrop effects, slows the sonar animation.
- **Slow**: removes optional gradients, contour textures, heavy shadows, decorative rivets/vignette, transition effects, and continuous sonar animation while preserving content and controls.
- **Offline**: not changed by Phase 3. Existing service worker + IndexedDB/offline sync remains separate and untouched.

No Phase 4 globe loading/asset changes were implemented.
