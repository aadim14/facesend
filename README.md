# FaceSend

Send event photos to the right people, automatically — entirely in your browser.

Drop up to 300 photos, FaceSend detects and groups every face locally, you tag each person once with a name and a phone or email, and it generates a private page per person containing only the photos they appear in, with a download-all button.

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
5. **Share** — `/p/<person>` pages list only that person's photos with a streaming zip download ([client-zip](https://github.com/Touffy/client-zip)).

### v1 limitation

Share links resolve from this browser's storage, so they only open on the device that created them. Hosting the pages so recipients can open them anywhere is the natural v2.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · @vladmandic/face-api 1.7.15 (pinned; models vendored) · idb · client-zip · Vitest

The implementation plan lives in [`docs/plans/`](docs/plans/).
