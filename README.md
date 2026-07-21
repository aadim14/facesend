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

> If the app stalls on "This browser's storage isn't responding", another tab is holding the
> database open — close other FaceSend tabs and reload. Chrome can also wedge an origin's
> IndexedDB after an abandoned upgrade; `http://127.0.0.1:3000` is a separate origin and works
> as an immediate escape hatch, and restarting the browser clears it.

```bash
npm test         # unit tests (clustering, validation, geometry, data layer)
npm run build    # production build
```

## How it works

1. **Upload** — photos are imported into IndexedDB with generated thumbnails.
2. **Detect** — each photo is downscaled to ≤640 px for detection, then each face is re-read from a higher-resolution crop of the original for its descriptor (~12 MB of model weights served from `public/models`).
3. **Cluster** — greedy centroid assignment over the 128-d descriptors, then a merge pass and a re-assignment pass, at a Euclidean threshold of 0.4. That is deliberately stricter than the canonical 0.6: splitting one person across two cards is recoverable, blending two people into one is not.
4. **Correct** — one card per person: name them, expand to see every face, eject one that doesn't belong, or skip them entirely. Pairs that landed in the `[0.4, 0.5)` uncertainty band are surfaced one at a time as "Same person?" — see below.
5. **Deliver** — each person's photos are packed into one zip containing an `index.html` that renders the gallery offline, then handed to the OS share sheet ([client-zip](https://github.com/Touffy/client-zip)). It has to be a single zip rather than loose files: Web Share flattens a file array, which would break the relative `photos/…` references.

More photos can be added to an event at any point from the review screen; only the new ones are detected, and names and merges survive.

### Why the threshold is strict, and what pays for it

0.4 over-splits on purpose — one person can land on two cards. That trade is only worth taking if undoing a split is trivial, so the app asks directly. The suggestion band is `[0.4, 0.5)`, not the canonical 0.6: measured over 231 known-different-person pairs, 0.6 produced 23 false prompts where 0.5 produced 3. A suggestion that isn't made still leaves two visible cards the host can merge; a suggestion that's wrong spends attention you don't get back.

Confirmed merges are recorded as a ledger of face-id pairs and replayed as a union-find on every subsequent clustering run. Clustering itself is stateless — it regroups every face from scratch — so without the ledger, adding a single photo would silently undo every correction already made.

### Design constraint

Delivery is portable by construction — the recipient opens a file, not a link, so nothing depends on the sender's browser storage or on FaceSend being hosted anywhere. That rules out cloud galleries and auto-SMS, which is the deliberate trade for keeping the app 100% on-device. The reasoning is written up in [`docs/prds/facesend-revamp.md`](docs/prds/facesend-revamp.md).

### Known limits

- Building a person's zip buffers it in memory. Desktop handles a few hundred photos; iOS Safari backs blobs with memory and gets unhappy somewhere north of a few hundred MB per person.
- Detection is sequential on the main thread. Roughly 0.3–0.7 s per photo on a machine with a real GPU, several times that on the CPU fallback — the app warns when it lands there.
- A completed share can't be confirmed. The OS never reports back whether the host finished sending, so the UI says "Shared", not "Sent".

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind 4 · @vladmandic/face-api 1.7.15 (pinned; models vendored) · idb · client-zip · Vitest

The implementation plan lives in [`docs/plans/`](docs/plans/).
