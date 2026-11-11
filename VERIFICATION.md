# Verification — Mikołaj

Verified against the real isolated Cloudflare Worker, not local mocks. No dependency installation, compilation, bundling, Node/TypeScript linting or local server was used on Mikrus. The browser executed the deployed JavaScript.

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

## Deliberate limitations

No automatic password reset, outgoing email, email verification, drawing Secret Santa pairs, photo uploads or dark mode. Invitation links remain valid until the administrator rotates them; no time-based expiry is claimed. Prices are indicative and links are provided by family members, not fetched from shops.
