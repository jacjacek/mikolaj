# Verification — Mikołaj

Verified against the real isolated Cloudflare Worker, not local mocks. No dependency installation, compilation, bundling, Node/TypeScript linting or local server was used on Mikrus. The browser executed the deployed JavaScript.

## GitHub delivery: verified push → domain

The complete source and history are in private `jacjacek/mikolaj`, with default branch `master`. GitHub-hosted Actions checks the code, updates the existing Worker and verifies the exact revision, HTML, frontend bytes, CSP and anonymous API. Push to `master` publishes production; push to `develop` publishes isolated preview. Credentials are not tracked.

A separate checkout cloned directly from GitHub created commit `11805d8241ce7605a49025141191ee375a8926d2`, changing the visible preview-menu heading to **Podgląd rodzinnych listów**. Its push automatically published preview. The release merge `557f266ac8b60df76759b4a456072a4d7fb2751f` then automatically published production, with no manual Worker upload from Mikrus. The actual production response matched the JavaScript blob read back from GitHub, and the new heading was visually checked on preview and production at 390×844.

The production proof run completed **14 seconds after the push event was created**: https://github.com/jacjacek/mikolaj/actions/runs/43053190203. This is an observed run, not a future latency guarantee. The immutable proof snapshot is `tests/results/github-delivery.json`; later documentation or application commits normally update `/version.json` again.

A real rerun of the older production workflow was also exercised: its second attempt skipped upload and deployment verification because the remote branch head had advanced, leaving the newer production revision unchanged. Both existing FAMILY namespaces and bootstrap bindings remained present; no production family data were mutated by the proof.

## Latest UI: Christmas palette and Świdermajer-inspired identity

The seasonal redesign passed **40/40 checks** on the deployed isolated preview, including all 33 two-tab regression checks below. The seven theme checks verify pine/burgundy instead of lime, primary-action contrast (**10.48:1**), actual intermediate height/opacity while opening and closing at 10% playback speed, rapid toggle recovery, reduced motion, and no collected runtime/CSP errors. Report: `tests/results/falenica-preview.json`.

Actual preview screenshots were visually inspected at **390×844**, **320×740** and **1440×1000**, including Listy, Moje and the accordion transition. Native details remain the fallback when newer CSS animation capabilities are unavailable. No Safari runtime pass is claimed. Application JavaScript, demo storage key/data schema, backend, authorization, bootstrap and Durable Object identities are unchanged.

An independent review found and fixed an older-browser reduced-motion regression: unsupported pseudo-elements must not share the ordinary universal selector list. The generic overrides are now separate from the guarded `::details-content` rule. A targeted real-browser CSS parser regression replaced that pseudo-element with an unsupported name; all four decorative elements still computed `.01ms` duration and zero delay (`tests/results/falenica-fallback.json`). This is not a Safari runtime test. The complete post-fix preview suite passed **40/40** again. New-document error instrumentation is now installed before navigation, not after initial load.

Earlier browser startup failures were environmental, not counted as passing checks. Cleaning up this task's completed browser-harness daemons restored a complete run; a redundant rerun had failed before Chromium exposed its debugging port and executed no UI checks. Hidden/background targets also throttled motion sampling; the complete suite activates its isolated target.

The final independent source review passed with no remaining findings, and the redesign was published to **https://mikolaj.walasek.xyz/**. All four served assets matched the local source byte-for-byte; the HTML contained the new identity and exactly two tabs, with a matching CSP nonce and no unsafe-inline. **13/13 source/API checks passed** (`tests/results/falenica-production-source.json`), including SQLite health, anonymous me and reservations remaining 401. A real 390×844 production screenshot was visually inspected with normal Chrome headers; the default headless headers initially received Cloudflare's security interstitial, which was not treated as the app. No security settings were changed.

**29 production UI checks passed**: 22 base-flow checks before the existing CDP reload timeout, plus all seven seasonal checks in a separate successful theme-only run (also validating that theme-only no longer requires a second flag). The remaining 11 checks are explicitly unverified on production, not passes. `tests/results/falenica-production.json` records the combined unique checks and the exact boundary. The complete post-fix preview suite remains **40/40**. Browser tests changed only fictional data in isolated local profiles, never real family records.

## Historical UI: two tabs and nested disclosures

`tests/ui_two_tabs.py` passed **33/33 checks** against the real isolated Cloudflare preview. The suite verifies exactly two primary tabs, the combined own-letter/wishes/reservations page, independent person accordions and nested gift details, preserving expanded state during reservation and purchase, contextual onboarding for each missing-content combination, all own empty-state CTAs and another person's empty list, snapshots and recipient privacy scoped to the own-wishes section, unsaved-letter protection, safe literal note rendering and Polish pricing, real reload persistence, old-link compatibility, local reset, zero private API requests and zero collected runtime/CSP errors. Mobile layouts at 390×844 and 320×740 and desktop at 1440×1000 passed overflow checks. The complete report is `tests/results/two-tabs-preview.json`.

The new default, combined Moje view and an expanded gift were visually inspected in an actual mobile browser on preview before publishing. The visual check caught and removed literal null placeholders from optional lazy-row content and refined gift summary alignment and the compact reservations shortcut. Backend, demo storage schema/key and authorization were not changed.

Production was published and read back: all four static assets matched the source byte-for-byte, HTML contained exactly two primary tabs with a valid CSP nonce, health was OK and anonymous reservations remained 401. **22 production UI checks passed**, including both tabs, nested disclosures, reserving/buying/releasing, combined-page privacy, unsaved letter protection and the missing-content/empty-state CTAs. The production rerun again hit the existing Chromium/CDP timeout during a full page reload; the remaining 11 checks are not claimed as production passes. Its explicitly incomplete report is `tests/results/two-tabs-production.json`; all 33 checks passed on preview. No real family data were changed by browser tests.

The API results and the pre-two-tab UI results below are historical verification of their respective versions, not additional checks counted in the new 33-check suite.

## API

- `tests/live_api.py`: **47 passing checks** on the isolated preview, including account creation/login/logout, invitation access and rotation, letter/wish persistence, ownership, invalid URL/price/size handling, cross-origin write rejection, reservation release/purchase and parallel reservation conflict.
- The parallel test returned exactly one HTTP 200 and one HTTP 409.
- Recipient wishlist JSON was identical before/after reservation and purchase; own-list responses do not query or include reservation data.
- `tests/reservation_snapshot.py`: reproduced a failure on the old deployment, then passed after snapshot support. Original purchase details survive a recipient edit; private changed-item metadata is only available to the reserver, never the recipient or another buyer.
- SQLite schema migration, sessions and existing preview data survived multiple Worker source deployments.
- Read-only independent backend review identified two medium issues: mutable purchase records and post-upload bootstrap persistence. Both were addressed; bootstrap now exists durably with mode 0600 before upload and is reused on retry.

## Real browser

Actual responsive viewports inspected: 390×844 and 320×740 mobile; 1280×850 desktop. No horizontal overflow observed on inspected mobile screens.

Interactions verified against the deployed API:

- Anonymous landing, valid invitation with family name, malformed-link explanation.
- Authenticated family/member lists, own and another person's letter/wishes.
- Add wish with Polish decimal price `149,90`; backend returned numeric `149.9`.
- A note containing `<script>test</script>` was rendered as literal text, not markup.
- Reserve through the interface; mark bought; server read-back confirmed purchased state.
- Edit an already-bought wish; shopping list preserved original title/price and displayed the changed-item warning. Current member list showed the new title, warning and no misleading purchase toggle.
- Own letter editing and save; wish edit; wish deletion with confirmation.
- Recipient interface showed no reservation/purchase state.
- Purchased cancellation required a confirmation; Escape dismissed it and returned focus to the prior element.
- Admin invitation reveal/hide and copy; clipboard read-back matched the expected private link format.
- `prefers-reduced-motion: reduce` shortened the observed CSS animations to 0.001 ms with one iteration, all finished.
- No collected JavaScript errors, unhandled rejections or CSP violations in the instrumented final interaction flows.

The browser used only generated preview-account session cookies for authenticated QA; no user's password was entered or collected. Account creation and password login were exercised via the real API. Production accounts have not been created by the agent.

## Production

- Custom domain `https://mikolaj.walasek.xyz/` attached to the production Worker and read back through Cloudflare API. Exact DNS read-back: proxied AAAA `100::` for this hostname only.
- HTTPS root and JavaScript returned HTTP 200 with correct MIME types; HTTP root returned 301 to HTTPS.
- Production health endpoint returned `{ok:true,storage:"sqlite",version:"1"}`; anonymous `/api/me` returned `{user:null}` and reservations returned 401.
- Production login and private family-creation screens were visually inspected at 390×844. The setup screen had all four account/family fields and no horizontal overflow; no production account was created.
- Initial headless headers triggered Cloudflare edge verification. Application HTML now includes a fresh per-response CSP nonce compatible with Cloudflare JavaScript Detections, without `unsafe-inline`; two HTTP reads confirmed matching HTML/CSP nonces and different nonces per response. Production app loaded with normal Chrome headers. No zone-wide security controls were disabled.
- The real production bootstrap secret was validated by a request deliberately rejected for an empty family name before account creation. Production remains ready for the user's first family.

## Login-free UX working mode

Default entry now opens an explicitly labelled, fictional family immediately, with no account/password. The sample state is stored under its own localStorage key and never calls the real API. Real authenticated mode remains available through `?live=1` and existing private setup/invitation links; backend authorization is unchanged.

Real-browser checks on the deployed preview passed for: wish creation with Polish decimal pricing, persistence after navigation/reload, no recipient reservation metadata, zero backend API requests in demo, changing the active fictional family member, reserving and marking a gift bought, protecting an unsaved letter when changing person, confirmed reset to the seed, and no horizontal overflow at 320px. The live-mode escape hatch still displayed the login form; anonymous direct API requests still returned `user:null` / HTTP 401. The 390px view was also inspected.

Demo changes are device/browser-local and do not synchronize with other family members. This is deliberate while iterating on UX, not a replacement for shared production storage. The reset action changes only the demo key.

## Minimal editorial redesign and mobile UX

The redesigned HTML/CSS/JS were deployed to the isolated Cloudflare preview before production. The old holiday stylesheet was replaced, rather than overlaid with overrides. Application storage, auth, real API, invitation tokens and Durable Object identities were not changed. The demo adapter only received a wording correction for the renamed reset control.

A fresh Chromium profile exercised the actual deployed ES modules at 390×844, 320×740 and 1440×1000. **25/25 final automated browser checks passed**, covering:

- Direct login-free family view, compact header, early visibility of family entries and no horizontal overflow.
- Quick-add from home; Polish comma pricing; literal HTML-like text; persistence after a real page reload.
- Author privacy, editing and saving the letter, guarding unsaved text when changing demo person, cancelling without losing the draft.
- Collapsed mobile member letter; availability filter with existing sample reservations; new reservations remaining visible in that filter; retaining an expanded letter during reservation refresh.
- Purchased state, grouped gifts view, confirmation before releasing a bought gift, cancelling that confirmation, and actual confirmed release.
- Changed-gift warning and original snapshot price; zero requests to the real API from demo; no collected JavaScript errors, unhandled rejections or CSP violations after reload.
- Confirmed local-only reset restoring the known four-person, fifteen-wish sample; desktop navigation fitting the viewport.

Final screenshots were captured from the real preview at mobile and desktop sizes. Reproducible browser automation is in `tests/ui_minimal.py` and `tests/cdp_browser.py`; the final machine-readable preview report is `tests/results/minimal-ux-preview.json`. The harness starts only an already-installed browser as a client of the remote deployment, with an isolated temporary profile; it never builds or serves the application locally.

Production source read-back confirmed byte-for-byte matches for `app.css`, `app.js`, `demo.js` and `favicon.svg`, matching HTML/CSP nonce without `unsafe-inline`, healthy SQLite storage and unchanged anonymous API authorization (`user:null`, reservations 401). A fresh production browser passed entry, layout, Escape/focus and quick-add checks. The complete production rerun stopped on a Chromium/CDP timeout during page reload; it is **not** counted as a passing full production suite. The full 25-check result above is from the isolated preview running the same verified frontend bytes. No Cloudflare security controls were weakened to force a pass.

## Deliberate limitations

No automatic password reset, outgoing email, email verification, drawing Secret Santa pairs, photo uploads or dark mode. Invitation links remain valid until the administrator rotates them; no time-based expiry is claimed. Prices are indicative and links are provided by family members, not fetched from shops.
