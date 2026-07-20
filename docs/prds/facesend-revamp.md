---
title: FaceSend On-Device Revamp — make it a product people actually use
slug: facesend-revamp
type: feat
status: draft
date: 2026-07-07
decision: build-smaller
origin:
  brainstorm: docs/plans/2026-07-07-001-feat-facesend-revamp-plan.md
  plan: docs/plans/2026-07-07-001-feat-facesend-revamp-plan.md
audience: [one-off event hosts]
evidence_sources:
  - code-sweep — /p/[personId] is dead/unlinked and device-local by construction; contacts.ts + ContactInfo are dead code; sent flag is optimistic
  - docs/plans/2026-06-09-002-feat-facesend-photo-distribution-plan.md — original build, KTDs, the "v1 links are local-only" known limitation
  - docs/ideation/2026-06-10-facesend-feature-ideas-ideation.html — 10 ranked ideas + competitor scan establishing on-device as white-space
  - git log — 6 of last 10 commits were clustering-accuracy tweaks; delivery gap untouched
---

# FaceSend On-Device Revamp — make it a product people actually use

## TL;DR

FaceSend groups event photos by who's in them, but can't actually *deliver* them: its share-link page is dead code that only opens on the device that created it, and its one working "send" makes the host manually push each person's photos through the share sheet, one at a time. This revamp keeps the (genuinely good) recognition engine and rebuilds the two things that gate adoption — **real delivery** (each person's photos become a self-contained gallery file sent via the OS share sheet) and **labeling** (a pass-the-phone self-claim kiosk so guests name themselves) — plus makes the on-device privacy story a *visible, demonstrable* feature. **Decision: build-smaller** — keep the engine, replace the delivery/labeling chassis, ship in dependency-ordered phases; do not add a server.

## Decision: build-smaller

Do **not** rewrite the app and do **not** add a backend. The clustering/recognition engine (`src/lib/face/*`, `images.ts`, `zip.ts`, `id.ts`, and `db.ts` transaction patterns) is tested and sound — reuse it. Replace only the delivery model, the labeling UX, and the storage-is-delivery assumption.

**What "smaller" means here — read this, it governs scope.** "Build-smaller" is a call on *two* axes:
- **Architecture (firm): no server.** 100% on-device. Everything below is reachable in the browser alone.
- **Commitment (staged): P0 is the committed MVP; P1–P3 are gated ambition, not equal commitments.** **P0** (real portable delivery + honest delivery state + silent-failure cleanup) is the one phase that must ship — it is the credibility fix that makes photos openable on other devices at all. **P1–P3 are the "everything" the host asked for, sequenced and each gated behind an explicit validation trigger** (below). They are *specified* here so the direction is coherent, but they are *conditional* — if a gate fails, that phase is deferred, not built. This is what keeps "build-smaller" honest despite a full-looking feature list: the list is a roadmap with off-ramps, not a commit-everything backlog.

Validation gates (a phase builds only after its gate passes):
- **P1 self-claim kiosk** — build only after confirming the "guests still together *after* processing finishes" window exists for a few real hosts (see Open Questions; this is the top product risk). Manual labeling + delivery is the always-available fallback, so a failed gate costs nothing downstream.
- **P1 privacy-visible layer** — this is **differentiation/marketing, not a proven adoption driver.** Ship it cheaply (service worker + a meter) but do not let it displace the labeling work; if effort is contested, labeling wins.
- **P2 corrections ledger + assists** — the Doubt Queue and rescue sweep are correction *assists*, not engine tuning (see the narrowed non-goal). Reinstate the Doubt Queue (the last two commits removed the old one) **only in its ledger-backed form**, whose difference is that answers persist as constraints instead of being discarded by the next re-cluster — the exact reason the old one wasn't worth keeping. If that persistence value doesn't materialize, it stays cut.
- **P3 Potluck + Consent Shield** — build only after the P1 kiosk window is validated (Potluck rides on it) and after the Consent Shield throughput spike passes. These serve **differentiation and retention, not the four core adoption goals** — they are the top of the ambition stack and the first to defer.

**Why not the bigger version (a server):** cloud links that open anywhere, zero-knowledge hosting, and auto-SMS/email would all make delivery smoother — but they require infrastructure, cost, and ops, and they dilute the one thing no competitor has (100% on-device). The host explicitly chose no-server. **Build-vs-use also considered:** platform-native shared galleries (iOS Shared Albums, Google Photos shared links) *do* give anywhere-openable links with no FaceSend server — but they don't do the per-person face-filtering that is the product's whole point, and they force every recipient into a specific account/ecosystem. Rejected for those reasons, not overlooked. The server path is documented as deferred, not attempted.

## Problem & evidence

FaceSend markets automatic photo *distribution*, but distribution is the missing half of the product:

- **The delivery link is dead.** `src/app/p/[personId]/page.tsx` is never linked from anywhere in the app (verified by grep), and is device-local by construction — its own not-found screen tells recipients to "open this link on the device that created it." A distribution app whose links can't open on anyone else's phone. *(Source: code-sweep; the original plan records this as the known "v1 links are local-only" limitation.)*
- **The only real "send" is manual and per-person.** `sharePersonPhotos` pushes one person's photos through the share sheet; the host must know and pick every recipient. For a 40-person event that's 40 manual sends. *(Source: code-sweep of `src/lib/share.ts`.)*
- **The contact system is dead code.** `contacts.ts` + `ContactInfo` validation are written, tested, and wired to nothing — the original "auto-notify each person" idea was quietly dropped. *(Source: code-sweep.)*
- **Effort has gone to the wrong place.** 6 of the last 10 commits tuned clustering accuracy; accuracy is past diminishing returns while delivery and labeling — the actual adoption blockers — went unaddressed. *(Source: git log.)*
- **On-device is real white-space but invisible.** Every competitor (Waldo, Premagic, Kwikpic, Pic-Time, Memzo, Fotify) is server-side; none markets on-device processing. FaceSend's differentiator exists only in the README, not the UI. *(Source: ideation competitor scan.)*

## Goals / Non-goals

**Goals**
- A first-time host, offline after first load, can go upload → deliver a gallery that opens on a recipient's own phone — no dead link, no false "shared."
- Cut labeling: guests self-claim by selfie where they can; the host types only stragglers.
- Make the on-device privacy property perceivable (watch it work with Wi-Fi off), not just asserted.
- No user-facing action fails silently.
- Reuse the tested engine; new logic is additive.

**Non-goals**
- Any server: anywhere-openable links, zero-knowledge hosting, programmatic SMS/email. (Deferred — see Rollout.)
- Accounts, login, cross-event people directory (that's a repeat-organizer product; not this user).
- Roster/CSV import, phone contact-picker autofill.
- Rewriting the recognition engine, or chasing raw algorithm/threshold accuracy (retraining, threshold tuning). *(This excludes the engine; it does **not** exclude user-facing correction assists — the Doubt Queue and rescue sweep in P2 are host-in-the-loop tools that persist a human's fix, not attempts to make the model itself more accurate.)*

## Requirements

Full numbered requirements with acceptance criteria and stable R-IDs live in the plan's Product Contract (`docs/plans/2026-07-07-001-feat-facesend-revamp-plan.md`). Summary by phase:

- **P0 — Deliver for real (R1–R4, R17).** Portable self-contained gallery bundle per person (photos + offline `index.html`); Web Share API with zip fallback; delete the dead `/p/` route; delivery marked only on a *confirmed* share; every failure visible.
- **P1 — Labeling + visible privacy (R5–R11).** Locked self-claim kiosk (selfie → on-device centroid match → guest self-labels); polished manual labeling for stragglers; service-worker offline shell + model precache; live network meter; end-of-event privacy receipt + optional retention sunset.
- **P2 — Assists + durable corrections (R12–R14).** Doubt Queue (only 0.45–0.60 uncertainty-band pairs as one-tap "Same person?"); rescue sweep (recover dropped sub-48px/orphan faces against labeled people); corrections ledger (must-link/cannot-link constraints that survive re-clustering).
- **P3 — Growth + consent (R15–R16).** Photo Potluck (guest contributes their own photos at the kiosk → re-cluster under the ledger → redistribute); Consent Shield (do-not-distribute person blurred in others' copies at bundle build).

## Proposed solution (UX)

The existing step flow (`upload → processing → review → done`) stays; the changes are at review and delivery, plus one new mode.

- **Deliver (replaces the dead link).** On each person's card in review/done, "Deliver" assembles their gallery and shares it as a **single `.zip` file** through the OS share sheet (AirDrop / WhatsApp / Mail); the recipient unzips and opens `index.html`. It must be one zip, not loose files: Web Share hands the OS a *flat* file array with no folder structure, so an `index.html` that references `photos/…` by relative path would break, and iOS would route the images to Photos and the HTML elsewhere. Desktop (no file-share support) falls back to the same named zip as a download. A separate **"Save photos to camera roll"** action shares the loose image files (photos only, no gallery) for recipients who just want the pictures in their roll. The card shows an honest state chip: *unlabeled / labeled / skipped / downloaded (send it yourself) / delivered*; delivered appears only after the share is confirmed. If the zip is large for the likely channel, the UI warns and offers a phone-sized export first.
- **Per-person by design (be honest about it).** Delivery is still one recipient at a time — with no server there is no address book to blast, and that is an accepted consequence of the no-server choice, not a gap this phase closes. The lever that reduces *host* effort is self-claim (guests pull their own gallery at the kiosk), not batch sending. P0 makes photos *openable on other devices*; it does not eliminate the per-person send action.
- **Self-claim kiosk (new).** The host taps "Pass the phone," handing over a locked screen exposing only: take a selfie → "Is this you?" with sample photos → type your own name/contact → (optionally) AirDrop yourself your gallery. No host controls, no other guest's contact, reachable from kiosk. Ambiguous or no match routes the guest to pick-from-candidates or hand-back-to-host — never a silent wrong attach.
- **Privacy made visible.** A persistent network meter shows zero outbound during processing; ending an event offers a receipt (N photos, M faces, processed on this device, 0 bytes uploaded) and an optional retention sunset date.
- **Review assists.** After clustering, an optional Doubt Queue shows only genuinely-uncertain pairs; after naming someone, a rescue sweep offers "found N more of <name>."

Keep the existing white/indigo, single-page, no-chrome design language; these are additions to it, not a new visual system.

## Data model & architecture

100% client-side; IndexedDB (`facesend`) via `idb`, evolved through **staged version bumps — land each migration before the code that reads it**:

- **v2 (P0):** `ClusterRecord.sent: boolean` → `deliveredAt: number | null` (+ `deliveryError?`). Migration **resets `deliveredAt` to null for all existing clusters** — the old `sent` flag was optimistic and untrustworthy. Revive `ClusterRecord.contact` reads.
- **v3 (P1):** `FaceRecord.belowThreshold?: boolean` — sub-48px faces are now *retained-and-flagged* (not discarded) so the rescue sweep has something to find.
- **v4 (P2):** new `corrections` store `{ id, kind: 'must'|'cannot', faceA, faceB, createdAt }`, indexed by face. Constrained clustering applies must-links via union-find pre-merge, cannot-links as hard blocks; on conflict the newer `createdAt` wins (older dropped, with a surfaced notice). The ledger earns its P2 keep immediately: today's `replaceClusters()` wipes manual merges on every re-cluster, so persisting corrections fixes a *present* bug — the heavier constrained-reclustering paths are simply exercised hardest later by P3 Potluck's append-and-recluster.
- **v5 (P3):** `ClusterRecord.doNotDistribute?: boolean`; blurred photo variants are ephemeral (built at delivery, memoized by `(photoId, flaggedFaceIds)`), not stored.

Key architecture calls: the bundle is **framework-free static HTML** authored fresh (`src/lib/bundle.ts`) — the dead Next route can't travel and is deleted. Offline is a **hand-rolled ~60-line `public/sw.js`** (explicit model precache + runtime app-shell caching + versioned cache + gated update prompt), no new PWA dependency. Full KTDs (KTD1–KTD8) in the plan.

## Edge cases & failure modes

Every user-facing action shows visible success or a visible, distinct error — silent failure is the top bug class this revamp targets (R17). Specifically:

- **Cancelled share** → person stays *not delivered* (never a false green check). **Failed share** → surface `deliveryError`, not a silent zip fallback presented as success.
- **Photo that fails detection** → tagged failed (`faceCount: -2`), surfaced as "N couldn't be processed — retry," *not* silently filed under "No faces found." **Variant-ripple guard:** `faceCount` now has three sentinels — `-1` unprocessed, `0` genuinely no faces, `-2` failed; every consumer (ProcessingStep resume, ReviewStep "No faces" filter, the new failed-photos surface) must branch on all three.
- **Self-claim no/weak match** → candidate pick-list or hand-back; never attaches the guest to the nearest stranger. Confident match requires nearest `<0.45` AND a `>0.05` margin over second-nearest.
- **Bundle exceeds channel size** → warn + offer phone-sized before sharing, not a mid-share failure.
- **Kiosk lock is soft (in-app), not an OS kiosk lock** — adequate for a bystander guest, not an adversary; state this plainly, don't imply OS lockdown.
- **Constraint conflict** (must-link vs cannot-link on the same pair) → newest wins, old dropped with a notice; never silently resurrect a fixed mistake.
- **Migrations** run incrementally; a returning v1 host walks straight to v5. **Safari 7-day eviction** — bundles are the durable artifact; receipt/retention wording must not promise permanence.

## Test plan

Encode requirements as tests (details per unit in the plan's Verification Contract):
- **Unit:** `bundle` (offline invariant, sanitation, phone-sized), `db` (v1→v5 migrations incl. honest-reset), `selfclaim` (confident/candidate/no-match + margin gate), `cluster` (constraint semantics + conflict rule + empty-constraints regression), `rescue`, `consent` (blur only where warranted, memoization, byte-identical untouched photos), `retention`; plus existing `cluster`/`contacts`/`images`/`zip`/`id` regressions.
- **Build:** `next build` clean on webpack (not Turbopack — existing constraint).
- **Browser (the acceptance examples):** AE1 bundle opens offline on a second device; AE2 cancelled/failed share never marks delivered; AE3 self-claim three paths; AE4 full flow in airplane mode with a zeroed meter; AE5 guest contribution re-flags delivery with corrections intact.
- **Invariant:** no code path constructs a device-local `/p/` URL.

## Rollout & seeding

Single-user client app — no feature flags, no seeding; phases gate on their dependencies, not config. Ship in order: **P0** (credibility: deliver for real) → **P1** (adoption: self-claim + visible privacy) → **P2** (moat: durable corrections + assists; U8 gates P3) → **P3** (capstone: Potluck + Consent Shield, each held behind a throughput/moderation spike with a documented fallback). Each phase is independently shippable and useful.

**Deferred (would need a server — out of this scope):** anywhere-openable links, zero-knowledge hosted blobs, programmatic SMS/email. **Trigger to revisit:** if validated demand shows hosts genuinely need recipients to open links without a file transfer, or need bulk automated sending — that's the point to reconsider a thin backend, as a deliberate identity/cost decision.

## Open questions

- **Does the self-claim window actually exist for real hosts?** The kiosk needs guests co-located *and* photos already processed (minutes on a phone). This is the top product risk. **Recommended:** ship a thin P1 kiosk, validate the "still-together-after-processing" window with a few real events before investing in P3 Potluck; treat manual labeling + bundle delivery as the reliable path and self-claim as upside.
- **Consent Shield throughput** — is synchronous per-recipient re-encode fast enough on ~300 photos? **Recommended:** spike before committing; fall back to whole-photo exclusion if not.

## Evidence trail

- **Brainstorm + Plan (same unified artifact):** `docs/plans/2026-07-07-001-feat-facesend-revamp-plan.md` — Product Contract (R1–R17, actors, flows, acceptance examples) enriched with Planning Contract (KTD1–KTD8, 12 phased implementation units, migrations, verification, DoD).
- **Original build:** `docs/plans/2026-06-09-002-feat-facesend-photo-distribution-plan.md` — architecture, KTDs, the documented local-only-links limitation this revamp targets.
- **Ideation:** `docs/ideation/2026-06-10-facesend-feature-ideas-ideation.html` — the 10 ranked ideas this scope draws from and the competitor scan.
- **Code:** `src/lib/face/*`, `src/lib/db.ts`, `src/lib/share.ts`, `src/lib/contacts.ts`, `src/app/p/[personId]/page.tsx` (to delete).

## Implementer handoff

Ready for an implementer model. To build this:
- `/ce-work docs/plans/2026-07-07-001-feat-facesend-revamp-plan.md` — run the phased plan directly (compound-engineering).
- Or paste this PRD into a fresh top-tier-model session as the goal.

Key constraints the implementer must honor:
1. **No backend, ever, in this scope** — everything is on-device; if a task seems to need a server, it's out of scope.
2. **Keep the engine; all new logic is additive** — reuse `src/lib/face/*`, `images.ts`, `zip.ts`, `id.ts`, `db.ts` patterns; do not rewrite clustering.
3. **No silent failures (R17)** — every share/detection/purge/kiosk action shows visible success or a visible, distinct error; delivery is marked only on a confirmed share.
4. **Ship P0 first** — it's the credibility fix and everything else builds on it; treat P1–P3 as gated ambition (each has a validation trigger in the Decision section), and note P2's corrections ledger (U8) gates P3.
