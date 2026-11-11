# Christmas in Falenica: authored, minimal visual redesign

## Current user correction — implement it
The user says the current design feels generic / AI-generated. They now explicitly want minimalist elegance WITH Christmas colours, Christmas accents and attractive animation, optionally inspired by Świdermajer because Christmas Eve will probably be in Falenica, on the Otwock railway line.
This supersedes the earlier instruction to avoid Christmas colours altogether. Do not undo the successful two-tab UX: Listy and Moje, people accordions, nested gift details, contextual completion prompt, all empty-state CTAs, buyer privacy, snapshots, unsaved-edit guards and local demo stay intact.

## Direction
Make it feel like a carefully art-directed small family application, not a SaaS dashboard with a Christmas skin, and not a themed greeting-card generator. Specific local craft, confident typography and restraint should do the work. Avoid equally rounded generic cards, default pill everything, citrus highlights, excessive metadata badges and huge generic serif typography on every object.

Palette: warm clean white (not fake parchment/texture), deep pine/bottle green, a muted oxblood/burgundy Christmas accent, optionally a tiny aged-brass detail. No neon lime. Ensure proper text/control contrast. Use green as structural ink and burgundy intentionally, rather than colouring every block red and green. Keep plenty of neutral canvas. Small deliberate corner radii (roughly 3–6px) and ruled rows can feel more architectural than soft dashboard bubbles. You choose the exact balanced values.

Typography: preserve readability and Polish glyphs. Existing Newsreader can remain for a distinctive wordmark/page heading, but gift titles and operational UI need not all be serif. Keep typography purposeful instead of using big serif as a shortcut for elegance. No added package or external icon library.

## Real architectural reference, actually examined
Photo of real veranda fretwork: https://mandalaman.pl/wp-content/uploads/piekne-ozdoby-azurowe-werandy-w-stylu-swidermajer-799x600.jpg
Hermes examined this photo: slender timber posts, repeated perforated circular/rosette geometry in frieze panels, small carved brackets below the beam, rhythm of upright posts, muted green-grey timber against dark pine foliage. Use the structural rhythm and negative space, not a literal tracing or a copy of the craftsman's pattern.
Background: https://mandalaman.pl/pl/swidermajer-budownictwo-drewniane-linii-otwockiej-bogato-zdobione-koronkami-i-azurami-z-drewna/
Another reference: https://www.werandaweekend.pl/w-podrozy/polska/swidermajery-drewniane-domy-z-dusza-ktore-wciaz-trzymaja-sie-zycia

Develop ONE original, coherent visual signature: e.g. a fine SVG veranda/gable/fretwork motif with a restrained Christmas star or a warm window, plus a related tiny divider/brand mark. It must actually read as timber veranda craft / Świdermajer, not just a generic triangle house or random snowflake logo. It can be a compact top-of-page ornament or wordmark companion, but it must not create a giant hero above the family list. On 390×844 the four collapsed people should still be visible (first rows early, preferably all four above the bottom nav). Reuse the motif sparingly; do not frame every person and gift with fretwork.

Create all shipped SVG art originally in source. Do not copy or hotlink the reference photo, architectural pattern, proprietary assets or fonts. Inline SVG via index.html sprite/template, JS's existing DOM SVG helpers or CSS data URI is fine. Avoid new asset files requiring deployment-client changes. Update the favicon and theme-color to fit. No ornamental Christmas emoji, wax seals, envelopes, postage stripes, stock Santa, fake handwritten notes, falling-snow overlays or huge glows/gradients. The product should feel personal without kitsch.

Do NOT assert a confirmed address, time, host or event date: the user said Falenica is probable, not confirmed. A subtle geographic inspiration is appropriate, an invented event invitation is not. Keep Polish functional copy short; no poetic AI-sounding slogans or fake numbered edition labels.

## Animation must be visible, tasteful and functional
User explicitly asks for attractive animation, not merely a changed colour transition.
- Smooth opening AND closing of person / gift disclosures, without breaking native details/summary keyboard semantics, independent open states, lazy loading, focus or content visibility. Native CSS progressive enhancement is preferred over rewriting the accordion in JS.
- MDN checked now: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::details-content — supports opacity plus content-visibility allow-discrete. Height animation using interpolate-size: allow-keywords is progressive only; guard with @supports and retain a fully usable fallback for older Safari. Be cautious with existing `.wish {display:grid}` / multiple direct detail children; test fallback layout rather than assuming CSS works.
- One special authored motion could reveal veranda line-work / a small warm window / Christmas star when the shell first appears. Avoid replaying a whole drawing on every quiet reservation refresh.
- Buttons/checkboxes can have restrained tactile feedback and a crisp purchase check transition. No confetti, looping snow, constant bouncing, slow staged lists, custom cursor, or animation delaying access to content.
- `prefers-reduced-motion: reduce` must eliminate decorative motion and make transitions immediate while preserving final visible states. Do not depend on unsupported View Transitions for functionality.
- No endless animation consuming a small phone's battery; original line reveal is finite. Use explicit transition properties, no transition:all.

## Source scope / implementation
Work in /srv/mikolaj on develop. Existing app is dependency-free HTML/CSS/JS ES modules. Rework `public/app.css` coherently in the current system, not hundreds of appended duplicate overrides. Touch `public/index.html`, `public/favicon.svg`, and narrowly scoped `public/app.js` visual construction only if needed for the original ornament or motion. Keep actual flow functions and API contracts stable. Do not touch src/worker.js, scripts/deploy.py, public/demo.js, or the browser regression tests. Hermes runs the remote preview and handles fixes/verification/deployment.

Important: KEEP EXACTLY `<script type="module" src="/app.js"></script>` in index.html — Worker uses that literal to inject a CSP nonce. No inline handlers/scripts, unsafe HTML or style attributes, new dependencies, canvas-heavy background, or external tracking. SVG uses must be present in the same document sprite. Existing fonts.googleapis.com / fonts.gstatic.com are allowed by CSP; no other new font/CDN hosts.

Retain identifiers / data-fkey / data-nav / data-person-id / data-wish-id hooks and `.person-fold`, `.person-fold__body`, `.wish`, `.wish__summary`, `.setup-prompt`, `#my-list`, `#my-reservations` needed by tests and logic. Preserve min 44px hit areas, keyboard focus, long-content wrapping at 320px, empty states and loading/errors.

If documentation is edited, update only README visual-design paragraph; do not claim tests have been run.

## Host restrictions
Mikrus is source/control-plane only. Tools: Read, Edit, Write, Glob, Grep, WebFetch for the public reference only. NO Bash/shell, installation, dependency fetching, compiling/bundling, linting/typecheck, local app/preview server, commands, git changes or deployment. Do not commit or push. No tool calls outside these allowed source operations.

## Deliver
Implement complete polished source changes now. Give a short rationale for the authored visual choices and motion, edited files, and any browser fallback limitation. Do not spend the run proposing alternatives: choose a coherent design and finish it.
