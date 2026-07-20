# FaceSend

Send event photos to the right people, automatically — entirely in your browser.

Drop up to 300 photos, FaceSend detects and groups every face locally, you tag each person once, and it hands you a self-contained gallery file per person — just the photos they appear in — that opens on any device with no app and no network.

**No server, no accounts, no paid APIs.** Face recognition runs client-side ([@vladmandic/face-api](https://github.com/vladmandic/face-api), SSD MobileNet + 128-d descriptors) and everything persists in your browser's IndexedDB.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

```bash
npm test         # unit tests (clustering, validation, geometry, data layer)
npm run build    # production build
```

## How it works

1. **Upload** — photos are imported into IndexedDB with generated thumbnails.
2. **Detect** — each photo is downscaled to ≤800 px and run through face detection, landmarks, and descriptor extraction (~12 MB of model weights served from `public/models`).
3. **Cluster** — greedy centroid clustering over the 128-d descriptors at a Euclidean threshold of 0.50, deliberately strict: the UI lets you merge two cards of the same person, but never has to split a bad merge.
4. **Tag** — one card per person with sample face crops; name + phone/email, merge, or skip.
5. **Deliver** — each person's photos are packed into one zip containing an `index.html` that renders the gallery offline, then handed to the OS share sheet ([client-zip](https://github.com/Touffy/client-zip)). It has to be a single zip rather than loose files: Web Share flattens a file array, which would break the relative `photos/…` references.

### Design constraint

Delivery is portable by construction — the recipient opens a file, not a link, so nothing depends on the sender's browser storage or on FaceSend being hosted anywhere. That rules out cloud galleries and auto-SMS, which is the deliberate trade for keeping the app 100% on-device. The reasoning is written up in [`docs/prds/facesend-revamp.md`](docs/prds/facesend-revamp.md).

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · @vladmandic/face-api 1.7.15 (pinned; models vendored) · idb · client-zip · Vitest

The implementation plan lives in [`docs/plans/`](docs/plans/).
