# Mikołaj: genuinely minimal editorial redesign + UX simplification

## User correction (the task)
The user says the current site should be more minimalist and elegant, explicitly referencing https://intentapp.dev/ again, and asks us to reconsider UX too. The current warm-paper/envelope/wax-seal direction was the wrong interpretation. This is a redesign of the actual working app, not a decorative CSS tweak or a proposal. Keep the login-free UX demo as default and all functional flows.

## Reference, actually inspected
Hermes inspected a real rendered desktop screenshot saved at `/root/.hermes/cache/scratch/intent-desktop-reference.png` — READ THIS IMAGE. Actual CSS was retrieved to `/root/.hermes/cache/scratch/intent-reference.css` if useful.
Visible/reference facts: near-white neutral canvas #f0f0eb, ink #080808, Inter for UI and restrained high-contrast editorial serif (ABC Arizona Mix, proprietary) for headings, exceptionally clear hierarchy, sparse navigation, flat black/white buttons, tiny controlled citrus accent #ddec61, large but purposeful whitespace. No beige parchment, postage decoration, red/green Christmas theme, physical stationery, woodcut illustration, drop shadows everywhere or busy metadata chips.
Do NOT copy proprietary fonts, logo or assets. Use a suitable free serif (e.g. Newsreader or Instrument Serif) with Polish glyph coverage, plus Inter or a good system sans. Authenticated app should borrow the restraint, NOT the landing page's enormous hero/empty height.

## Product/UX direction
Make a small elegant family utility, not a Christmas-themed dashboard or marketing page.

### Default family view
- On a phone, show the actual family list immediately. Remove the enormous greeting/intro, calendar/countdown card, decorative counts chips and standalone giant own-list widget. In the first 390×844 viewport the user should already see useful member/list entries, not instructions and decoration.
- One short heading such as "Listy bliskich" and a quiet inline count. A small clear primary action "Dodaj życzenie" can open the existing own-item dialog directly (works from home).
- Family members including the current user's own entry belong in ONE coherent grid/list. Mark self with a tiny "Twój list" label; no separate repeated section and duplicate actions. Each entry: name, at most 1–2 lines of letter preview, wish count, clear open affordance. Flat surface or fine divider, no flap, stamps, wax seal, colored avatar blocks or nested panels. Make touch targets sensible without wasting a screen per person.
- Empty family and empty wishes states should be calm text + relevant action, not large illustrations.

### Own list and other people's lists
- Strong, compact heading, then actual wishes. Reduce the current explanatory paragraphs and enormous privacy panel to one quiet line where it is needed.
- Remove paper textures, ruled lines, postage borders, arbitrary "Drogi Mikołaju" repeated in multiple layers, and oversized blank letter blocks. A personal letter is content, not a simulated sheet of paper. Keep writing/editing the letter easily discoverable; a compact disclosure is acceptable on mobile if it helps wishes appear sooner. Do not silently discard edits when collapsed/navigated away.
- Wish entries should be compact editorial rows/cards with title and price hierarchy, brief notes and discreet shop link. One dominant action to reserve an available wish, restrained bought toggle and cancellation for your own reservation, clear passive "Zajęte" state for others. No rubber-stamp overlay, red/green theatrics or animation on every small interaction.
- Keep recipient privacy: NO reservation counts, status or buyer info on own list.
- If helpful, implement a simple real "Wszystkie / Dostępne" filter for others' lists; do not add a nonfunctional filter or replace the existing privacy/snapshot behavior. It's optional — clarity before adding features.
- Preserve snapshot warnings when a reserved item changes, but use a quiet inline note rather than a huge callout.

### My gifts
- Keep grouping by recipient and functional bought/cancel controls, but reduce large summary tiles/progress/dashboard decoration to a compact readable summary.
- Use short Polish copy. Preserve meaningful confirmations (delete, cancelling a bought gift, resetting demo), ownership checks, error states, focus handling, live mode and unsaved-letter safeguards.

### Demo tools
- Default remains directly accessible, no login. Real backend and `?live=1` remain protected.
- The current persistent demo bar is too prominent. Turn it into a compact, quiet tool area (possibly integrated with header) with a native person switcher and explicit small "Dane przykładowe" / "Podgląd" + "Zapis lokalny" cue. Keep reset discoverable, optionally behind a disclosure/menu. Don't fill a quarter of a phone screen explaining the demo.
- Avoid duplicating the active person's name in several header controls. Don't hide whether data are examples/local. Preserve switching and reset functionality and cancellation of unsaved edits.

### Navigation and interaction
- Keep navigation obvious and mobile-friendly. A refined text/icon bottom bar is fine if it does not look like a second oversized dashboard; desktop navigation can be quiet text tabs. No novelty gesture-only controls, fancy cursors or distracting hover sequences.
- Header brand should be simple typographic "Mikołaj", not the red wax seal. Update the favicon/theme color too.
- Motion: just brief opacity/color/transform transitions where useful; reduced-motion support; no springy envelope opening, bouncing, stamps or staged animation every time a page refreshes.

## Implementation requirements
- Existing framework: dependency-free HTML + CSS + browser JavaScript ES modules. Use the existing DOM construction helpers. Do not introduce React, Tailwind, packages or a second styling system.
- Rewrite/consolidate `public/app.css` into the new coherent style system; do NOT append hundreds of overrides over the old holiday CSS. Update actual markup/functions in `public/app.js` and `public/index.html` where UX needs restructuring. Remove unused decorative templates/assets/styles where safe rather than hiding clutter with random CSS.
- Keep element IDs and data-nav/data-fkey hooks required by existing logic, or update every consumer correctly.
- `src/worker.js`, `scripts/deploy.py`, real backend API and demo data adapter contracts should NOT need changes. Avoid touching them. Keep `public/demo.js` behavior and its storage key/schema so existing demo edits survive.
- CSP is strict. No inline event handlers, inline scripts or unsafe HTML. Fonts from fonts.googleapis.com/fonts.gstatic.com are allowed. In index.html KEEP EXACTLY `<script type="module" src="/app.js"></script>` because the Worker inserts a per-response nonce by matching that literal.
- Use plain text for all user-supplied content. Safe http/https shop links, no buyer metadata leaks. Do not generate data that pretend to be real family records.
- Body/notes readable, headings balanced, 44px touch targets, visible keyboard focus, no horizontal overflow at 320 or 390px. Check that longs names/URLs don't stretch layouts. Native dialogs remain accessible; Escape/cancel/focus restoration must work.
- Update README briefly to reflect the new visual and UX approach, without claiming execution or tests.

## Host restrictions
Mikrus is source/control-plane only. DO NOT run shell/Bash, install dependencies, compile/bundle, lint/typecheck, execute Node, start a local server or perform deployment. Tools allowed: Read, Edit, Write, Glob, Grep only. Hermes will use the real deployed Cloudflare preview for browser verification before publishing to production.
Do not commit or push. Work only inside /srv/mikolaj (except reading the two public reference files in scratch).

## Deliver
Complete working source changes, not a plan. Report the UX decisions and exact edited files concisely, flag any functionality you couldn't preserve. The goal is a noticeably more elegant, useful app — not another themed landing page.
