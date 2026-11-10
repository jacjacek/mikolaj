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

## Deliberate limitations

No automatic password reset, outgoing email, email verification, drawing Secret Santa pairs, photo uploads or dark mode. Invitation links remain valid until the administrator rotates them; no time-based expiry is claimed. Prices are indicative and links are provided by family members, not fetched from shops.
