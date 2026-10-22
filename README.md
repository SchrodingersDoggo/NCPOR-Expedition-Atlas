# NCPOR Expedition Atlas

A web portal for polar and ocean research that keeps working when the internet doesn't.

Researchers at remote stations can log expeditions, upload large scientific datasets, photos, videos and reports, explore the data in the browser, and turn field footage into short outreach reels. All of it is designed around slow, flaky and sometimes missing connections, because that is what a research station on the ice actually has.

**Live demo:** [https://polar-science-outreach-portal-2.onrender.com/](https://polar-science-outreach-portal-2.onrender.com/)

> This is a working prototype, not a production-hardened system. See [Known limitations](#known-limitations).

---

## Why this exists

NCPOR already runs the National Polar Data Centre, so this project is not trying to replace it. The gap we looked at is the workflow around the data: a researcher uploads in one tool, plots in another, gets it reviewed somewhere else, and then has to rebuild all the context to explain it to the public. And all of that assumes a decent connection.

The Atlas puts the whole path in one place: record the expedition, describe and upload the data, review it, publish it, explore it, and share it. Every step is built to survive a bad network.

---

## What it does

### Works offline and on bad networks
- **Offline queue.** Every action (new expedition, edit, report, photo, dataset) is saved to IndexedDB first, then synced. Nothing is lost if the tab closes or the network drops.
- **Smart retries.** Failures are sorted into types (no network, expired login, server error, conflict, low device storage, and more). Each type decides whether to retry, pause or stop. Losing the network never counts against the retry limit, only real server rejections do (max 5 attempts).
- **Conflict detection.** Edits send the version they were based on. If someone else changed the expedition in the meantime, the server answers `409` with its current copy instead of overwriting it, and the Sync Center shows the conflict.
- **Low-bandwidth mode.** The app measures the connection (Network Information API plus a small timed download as a fallback) and picks fast, medium or slow. On slow links the 3D globe is never downloaded and images are requested smaller. You can also force a mode by hand.
- **Installable and offline-ready.** A hand-written Service Worker caches the app shell, so the app and your saved expeditions open with no connection.
- **Save for offline.** Researchers can pin expeditions (and their cached visualisations) to the device.

### Large dataset uploads that can resume
- Datasets go to MinIO (S3-compatible storage), not through the API server.
- The browser cuts the file into parts (5 MiB minimum, larger for huge files to stay under S3's 10,000-part limit), hashes each part with SHA-256 in a Web Worker, and uploads them straight to MinIO with presigned URLs.
- If the connection drops, only the missing parts are sent again. Expired upload links are refreshed, and a browser restart picks the session back up.
- Completion is safe to retry, so a lost response can't create duplicate records.
- Downloads use short-lived presigned URLs created on demand. The raw storage path is never exposed.

### Data visualiser
- Reads **CSV, TSV, XLSX, JSON, Sea-Bird CNV, NetCDF (classic and NetCDF-4) and HDF5**.
- Parsing happens in Web Workers so large files don't freeze the page.
- It only offers views the data can actually support: tables, histograms, time series, depth profiles, maps, curtain sections, depth slices and 3D views.
- Handles fill values, scale factors, offsets and CF-style time so the numbers shown are the real ones.
- Uses oceanographic colour conventions (temperature, salinity, chlorophyll, anomalies) with legends.

### Access control and review
- Roles: `public`, `researcher`, `comms_officer`, `admin`. Guests can browse published material without an account.
- Accounts have an approval status (`pending`, `active`, `suspended`, `rejected`).
- Content moves through `draft`, `in_review`, `published`. Researcher uploads wait for review, staff uploads are trusted.
- Every dataset has an access level: `open`, `registered`, `request_required` or `restricted`. Request-based access needs an approved request unless you are the owner or staff.
- All of this is enforced on the server, not just hidden in the UI.

### Explore, search and archive
- 3D globe of expeditions and stations, a region and timeline explorer at `/explore`, and an archive with filters (region, domain, year, researcher, keywords).
- Full-text search on PostgreSQL (`tsvector` with a GIN index).
- Controlled keywords with a review step, and a metadata-first dataset model so a dataset can be described before its file arrives.
- Emergency alerts with a danger level per expedition.

### Studio (AI outreach)
- Upload field videos and notes. Studio uses **TwelveLabs** to understand the footage, **ElevenLabs** to narrate in 19 languages, and **Creatomate** to render a vertical reel of up to 45 seconds.
- If narration fails, the reel still renders with the original audio.
- A researcher previews the result before anything is published.
- A separate Gemini-powered endpoint drafts captions, hashtags and alt text for content items.

### Community
- Reddit-style communities with posts, nested comments, votes, tags, moderator tools, notifications and direct messages.
- An Activities area for field observations and official event notices.

---

## Tech stack

| Layer | What we used |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 4, React Router 7, Three.js, react-globe.gl, Recharts |
| Browser data and offline | IndexedDB (`idb`), Service Worker, Web Workers |
| File parsing (client) | PapaParse, SheetJS (`xlsx`), `h5wasm` |
| Backend | Node.js, Express 4, Prisma 5, JWT, bcrypt |
| Database | PostgreSQL |
| Dataset storage | MinIO (S3-compatible), AWS SDK v3 |
| Media storage | Cloudinary |
| AI and media | Google Gemini, TwelveLabs, ElevenLabs, Creatomate |

---

## How the pieces fit

```
Browser (React + Vite)
  |-- Service Worker .......... app shell cache
  |-- IndexedDB ............... offline queue, saved expeditions, sync state
  |-- Web Workers ............. SHA-256 hashing, dataset parsing
  |
  v
Express API (auth, workflow, access control)
  |-- PostgreSQL (Prisma) ..... users, expeditions, metadata, permissions, review state
  |-- MinIO ................... scientific datasets (multipart, presigned URLs)
  |-- Cloudinary .............. photos, videos, reports, avatars
  |-- TwelveLabs / ElevenLabs / Creatomate / Gemini
```

The idea behind the split: the database knows a dataset exists, who owns it, how it is described and who may see it. MinIO holds the large files. Cloudinary handles media that is fine to resize or compress. A scientific file is never recompressed to save bandwidth.

---

## Project structure

```
.
├── client/
│   ├── public/               sw.js, manifest, probe payload
│   └── src/
│       ├── api/              axios wrappers per feature
│       ├── components/       globe, explorer, archive, communities, sync center
│       ├── context/          auth and network context
│       ├── hooks/            network quality, sync status, alerts
│       ├── offline/          queue, sync manager, error classifier, IndexedDB
│       ├── pages/            route-level pages
│       ├── utils/            adaptive images, SHA-256, dataset parsing
│       ├── viz/              readers, detection, workers, renderers, tests
│       └── workers/          checksum worker
└── server/
    ├── prisma/               schema, migrations, search extension SQL
    ├── scripts/              MinIO setup and connection tests
    └── src/
        ├── config/           prisma, minio, cloudinary
        ├── controllers/
        ├── middleware/       auth, uploads, rate limiting
        ├── routes/
        └── services/         minio, studio, notifications, data extraction
```

---

## Getting started

### What you need
- Node.js 20.19 or newer (needed by the Vite version in use)
- PostgreSQL
- A MinIO server (local or hosted)
- A Cloudinary account
- API keys for Gemini, TwelveLabs, ElevenLabs and Creatomate if you want to use the AI features. The rest of the app runs without them.

### 1. Backend

```bash
cd server
npm install
cp .env.example .env        # then fill in the values (see below)

npx prisma generate
npx prisma migrate deploy   # or `npx prisma migrate dev` while developing
npm run db:search-setup     # adds full-text search (tsvector, trigger, index)
npm run minio:setup         # creates the private bucket and sets its CORS rules
npm run minio:test          # optional: checks the MinIO connection

npm run dev                 # http://localhost:5000
```

### 2. Frontend

```bash
cd client
npm install
npm run dev                 # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:5000`, so the client needs no environment variables.

### 3. Create your first admin

People can only sign up as `public` or `researcher`. Admin and Comms Officer roles are handed out by an existing admin, so the very first admin has to be set directly in the database. After registering a normal account, run:

```bash
cd server
npx prisma studio
```

Open the `User` table and change that user's `role` to `admin` and `accountStatus` to `active`. From then on you can approve accounts and assign roles from the app.

### Environment variables (`server/.env`)

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 5000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Token signing secret and lifetime |
| `FRONTEND_URL` | Frontend origin |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Media storage |
| `GEMINI_API_KEY` | Caption and alt-text drafting |
| `TWELVELABS_API_KEY`, `TWELVELABS_MODEL` | Video understanding in Studio |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | Narration (optional, Studio falls back to original audio) |
| `CREATOMATE_API_KEY` | Reel rendering |
| `PUBLIC_API_URL` | Public backend URL for the Creatomate webhook |
| `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL` | MinIO location |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_REGION` | MinIO credentials and bucket |
| `MINIO_CORS_ORIGIN` | Frontend origin allowed to upload and download directly |
| `MINIO_PART_URL_EXPIRY_SECONDS`, `MINIO_DOWNLOAD_URL_EXPIRY_SECONDS` | Presigned URL lifetimes |
| `MINIO_UPLOAD_SESSION_EXPIRES_IN` | How long an unfinished upload session stays resumable |

Never commit your real `.env`.

---

## Testing the offline behaviour

The Service Worker only registers in a production build, so test offline features like this:

```bash
cd client
npm run build
npm run preview             # http://localhost:4173
```

1. Open the app once while online so the shell gets cached.
2. In DevTools, go to Application, then Service Workers, and confirm `sw.js` is active.
3. Set Network to Offline and reload. The app should still open.
4. Queue an upload or an expedition edit while offline, then go back online and watch it sync in the Sync Center.

To try the slow-network path, use the manual mode toggle in the app. Chrome's throttling presets don't always change the values the Network Information API reports, so the manual toggle is the reliable way to test it.

### Automated tests

```bash
cd client
npm run test:viz
```

These cover the visualiser: file readers, detection, time parsing, NetCDF and HDF5 handling, sampling, caching and the workbench UI model. Test fixtures include real `.nc`, `.h5`, `.cnv`, `.xlsx` and malformed JSON files. The server doesn't have automated tests yet.

---

## API overview

Everything lives under `/api`. Main groups:

| Path | What it handles |
|---|---|
| `/auth`, `/accounts`, `/users` | Register, login, approval, profiles |
| `/expeditions`, `/alerts`, `/stations` | Expeditions, danger alerts, research stations |
| `/content`, `/upload`, `/archive`, `/search` | Reports, photos, videos, archive filters, full-text search |
| `/dataset-upload` | Multipart upload sessions: init, part URL, status, complete, abort |
| `/dataset-metadata`, `/keywords`, `/dataset-access-requests` | Metadata, review workflow, controlled vocabulary, access requests |
| `/studio`, `/ai` | Reel generation, caption and alt-text drafting |
| `/communities`, `/activities`, `/notifications`, `/messages` | Community and engagement features |
| `/health` | Simple health check |

---

## Known limitations

We would rather you hear these from us.

- **Prototype security.** CORS is open, rate limiting only covers the community endpoints, there are no security headers, and the role and account status live inside the JWT, so a change only applies after the token is renewed. It needs a proper security review before any real deployment.
- **No persistent identifiers.** There is no DOI minting, citation export or full provenance trail, and we don't claim FAIR certification. Metadata is structured in a FAIR-friendly way, but that is a direction, not a badge.
- **Browser limits.** Offline storage is finite and differs by device. Files over 100 MiB are not queued in the offline Blob queue and go through the resumable upload path instead. Large HDF5 files are limited by what a browser can parse.
- **Station data is minimal.** Only three Antarctic stations are seeded in code.
- **Network numbers are test conditions.** The 9 kB/s figure is a stress-test setting we chose, not a measurement of NCPOR's actual links.
- **Studio depends on third-party APIs** that can be rate limited or unavailable.
- **AI output needs a human.** Studio previews exist so a person approves anything before it goes public.
- **Dependencies.** `xlsx@0.18.5` has known security advisories and should be replaced or pinned to a patched build.
- **No server-side automated tests** yet.

---

## Where we'd take it next

- Mapping our metadata to NPDC's institutional schema so the two systems can talk to each other
- DOI or institutional identifiers, citation export and versioned metadata
- Deeper CF-convention handling and GeoTIFF / GRIB readers
- A local edge cache or sync node at stations for long outages
- SSO, audit logs and automated authorization tests
- More Indian languages for narration beyond Hindi and Tamil, plus captions and transcripts for accessibility

---

## Acknowledgements

The public documentation of the UK Polar Data Centre, Australian Antarctic Data Centre, NASA NSIDC and PANGAEA shaped how we thought about metadata and discovery.