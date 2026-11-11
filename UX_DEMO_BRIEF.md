# Login-free UX working mode

Implement now, source-only. The user says: "zrob na razie bez logowania wejscie, pracujmy nad ux bez tego". We agreed: root opens directly into an explicitly labelled sample family, no account/password, isolated from real private family data. Preserve the existing warm paper design; no redesign needed.

## Host restriction
Mikrus is control-plane only. DO NOT run any shell, install dependencies, compile, lint, typecheck or start a local server. Use Read/Edit/Write only. Hermes will deploy and exercise the real preview in a browser. No git commands.

## Implementation

1. Add dependency-free browser ES module `public/demo.js` implementing a fully working local demo API matching the API calls in `public/app.js`. Export mode flag and functions needed by UI.
   - Default root and normal `#/...` app routes use demo. Escape hatch `?live=1` or an initial real setup/invitation fragment keeps the existing real-auth application unchanged. DO NOT weaken backend authorization. Do not copy or read any production account, session or private data.
   - Store only sample/demo data under a NEW versioned localStorage key such as `mikolaj.ux-demo.v1`; never use the real API in demo. Seed only when entering demo mode. Gracefully fall back to in-memory state when localStorage is unavailable/corrupt; tell the user if state is only in the tab. Avoid a boot-time infinite rendering loop.
   - Seed 4 explicitly fictional family members (Ania, Bartek, Marta, Tomek) with short Polish letters and realistic example wishes, prices and optional safe links. Around 3-4 wishes each is enough. Include free gifts, a gift reserved by someone else and one of the active user's reservations marked bought so all UX states are visible from the beginning. No external photos needed. Use generic legitimate shop homepage links or no links; prices are illustrative, not researched offers.
   - GET /api/me always returns the active demo person/family/members (same schema; do not expose real email). isAdmin can be false for all demo members because invitation/auth flows are out of scope in this UX pass.
   - Support real interaction behavior locally: letter editing, own wish add/edit/delete, viewing other people's lists, reservations, purchase toggle and cancellation, snapshots/change warnings, accurate counts. Validate the same constraints as the existing UI/backend. Reject self-reservation and edits to others, reject reserving occupied items, and return status-aware errors to the app so existing handling works.
   - Return NO reservation metadata on the active person's own wish response. Only reserver sees changedSinceReservation. /api/reservations returns snapshots and original purchase data.
   - Handle all supported paths/methods explicitly; unsupported actions fail instead of silently succeeding. No fake copy/send/sync operations.
   - Local writes persist after reload and switching demo identity; reset returns to the original seed. Validate active ID and storage schema enough to recover corrupted demo state without touching other localStorage entries. Use text-only DOM insertion, no unsanitized HTML.

2. Integrate the demo adapter at the start of the existing `api()` function. Keep inflight accounting and convert demo errors into existing ApiError. The real fetch path remains unchanged in live mode.

3. Add a compact, accessible, responsive work-mode bar when in demo:
   - Explicit copy: "Podgląd UX · dane przykładowe" and short clear note that changes stay on this device/browser, NOT shared with family.
   - A labelled native select "Podgląd jako" lets us switch all four family members without logging in. No password modal or identity onboarding step. Initial identity selected automatically (Ania).
   - A small "Od nowa" reset button with a confirmation before resetting local demo data.
   - Respect unsaved letter edits before switching/resetting; do not lose them silently. On cancellation restore prior select value; on confirmed switch render the right identity and navigate to family home.
   - Hide the logout button and invite nav in demo. No auth-related messages or pending-link notices in demo. For a manually opened invitation page in demo show a clear informational message, no inert buttons. Do not show the existing login landing on default entry.
   - Do NOT make session/auth changes on the server when demo starts, ends, or resets. Real access through ?live=1 remains available but does not need a prominent distracting button in the demo UI.
   - Use existing CSS design tokens, modest spacing, 44px touch targets. Keep mobile navigation usable at 320/390px. Do not replace existing notice rendering with something which clears/recreates the user's select on every keystroke or steals focus during refresh.

4. Wire the new asset into direct source deployment: `src/worker.js` imports public/demo.js AS TEXT and serves /demo.js with JS MIME, exactly like app.js; `scripts/deploy.py` uploads this additional file as text/plain. Preserve CSP nonce logic, stable DurableObject names/bindings and ALL real backend behavior. No database migration is needed for demo.

5. Update README with default working mode, device-local behavior/reset and how to reach real protected app. Keep existing documentation about real data/auth, qualify it as live mode. Do not claim tests were run.

Deliver all source changes complete. Report files and integration boundaries briefly. Do not run any tools other than Read/Edit/Write. No need to add a test harness page or new framework.
