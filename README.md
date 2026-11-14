<p align="center">
  <img src="public/icon-192x192.png" width="96" height="96" alt="Mikołaj icon">
</p>

<h1 align="center">Mikołaj</h1>

<p align="center">
  Private family wish lists for Christmas — everyone writes a letter to Santa,<br>
  relatives quietly pick gifts, and nobody buys the same thing twice.
</p>

<p align="center">
  <a href="https://list.do.mikolaja.pl"><strong>list.do.mikolaja.pl</strong></a>
</p>

---

## Overview

Mikołaj (Polish for *Santa Claus*) is a small, private web app for families. Each person writes a short letter to Santa and adds wishes; the rest of the family reserves gifts so they don't double up. The surprise stays a surprise: **a recipient never learns what has been reserved on their own list** — not in the interface and not in any API response.

The app is in Polish, minimalist by design (white and dark grey, a serif for accents, no borders or decorative icons), works on phones and desktops, supports light and dark mode, and can be added to the home screen as an app.

## Features

### For everyone

- **Listy** — the family's lists. Each person folds open to their letter and wishes, sorted from cheapest. *Kupię to* (“I'll buy this”) reserves a gift; the name sticks to the top while you scroll through that person's list.
- **Kupuję** — what you've picked for others, grouped by recipient, with *mark as bought* and *give up*. The tab appears only once you've reserved something.
- **Moje** — your own letter and wishes, plus any people you manage.
- **Budget tiers instead of prices** — every wish is tagged *Drobnostki* (up to 50 zł), *Nie było niegrzecznie* (50–200 zł), *To był grzeczny rok* (200–300 zł) or *Byłem aniołkiem* (no limit). Lists are ordered by tier.
- **Change notices** — if a wish's budget changes after you reserved it, you see what it was before.
- **Demo family** — the landing page opens a fully working example family in the browser, with no account and nothing saved.

### People without a phone

Children or grandparents don't need an account. Anyone allowed to add people can create them and write their letter and wishes on their behalf; gifts for others are still reserved from the manager's own account. Later, a one-time link lets that person take over their list with their own e-mail and password.

### For the family organiser

Whoever creates a family becomes its organiser and gets the **Rodzina** tab:

- invitation link (copy or regenerate) and e-mail invitations,
- bulk-adding people without accounts, one name per line,
- per-person actions: password-reset link, permission to add people, change of manager, hand over the organiser role, remove from the family,
- **organiser mode** — opt-in, per session, switched off automatically after an hour (enforced by the server). While it's on, the organiser can see who is buying what, edit other people's lists and assign gifts on their behalf. Their own list stays hidden from them even then.

### E-mail

Sent through [Resend](https://resend.com) from `listdo@mikolaja.pl`:

- password reset (*Nie pamiętasz hasła?*),
- invitations sent by the organiser,
- a daily noon digest: new free wishes from relatives, and a reminder about gifts you picked but haven't bought yet,
- a reminder three weeks before Christmas Eve (3 December).

No e-mail ever reveals who is buying what for whom.

## Architecture

```
public/            frontend — plain HTML, CSS and ES-module JavaScript, no build step
  index.html       includes the pre-rendered landing page, so it paints before any JavaScript
  app.css          inlined into the HTML by the Worker (nonce'd <style>), also served on its own
  app.js
  *.woff2          self-hosted Inter and Newsreader, subset to Latin + Polish
  *.png, *.webp, favicon.ico, site.webmanifest   icons and web-app manifest
src/worker.js      Cloudflare Worker + one SQLite-backed Durable Object (FamilyStore)
scripts/
  deploy.py              uploads the sources to the existing Worker via the Cloudflare API
  verify_deployment.py   checks the live revision, every public file byte for byte, CSP and the API
  branch_head_guard.py   skips superseded CI runs so an old run can never overwrite a newer one
.github/workflows/deploy.yml   push to master → check → upload → verify
```

- **Only the landing page is public.** Search engines may index `/` (robots.txt, sitemap, canonical, JSON-LD); everything else lives behind `/api/` (disallowed, `X-Robots-Tag: noindex`, login required) or after the `#` in the URL, which never reaches a server.
- **No dependencies and no bundler.** The Worker imports the frontend files directly; images and fonts are uploaded as data modules. Icons and fonts are cached for a year, so a changed file needs a new name.
- **One API call for the whole UI.** `GET /api/state` returns everything the signed-in person may see, already trimmed by the server; the client re-renders from it after each action.
- **Many families, one store.** All families live in one Durable Object, every query is scoped by family, and families never see each other.
- **Additive migrations.** Schema changes run at start-up and only add columns or tables; existing data is never removed.

## Security and privacy

- Passwords: PBKDF2-SHA256, 100,000 iterations, random salt.
- Sessions: random 256-bit token, only its hash is stored; `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Strict`, 30 days.
- Writes require the app's own `Origin` and a JSON body; requests are rate-limited per IP.
- Strict Content-Security-Policy with a per-response script nonce.
- One-time links (invitations, password resets, account hand-over) carry 256-bit secrets in the URL fragment and are removed from the address bar on load.
- All permissions — ownership, managers, organiser mode — are checked on the server.

## Deployment

Every push to `master` deploys to **https://list.do.mikolaja.pl** through GitHub Actions:

1. syntax check of the frontend and the Worker,
2. guard against superseded runs,
3. upload to the existing `mikolaj` Worker (bindings, secrets and the Durable Object namespace are preserved),
4. verification of `/version.json`, every file in `public/`, the CSP and the anonymous API.

The old address `mikolaj.walasek.xyz`, as well as `mikolaja.pl` and `mikołaja.pl`, redirect to the app. The live revision is always available at [`/version.json`](https://list.do.mikolaja.pl/version.json).

The workflow needs a `CLOUDFLARE_API_TOKEN` secret and the `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ZONE_ID` variables. `RESEND_API_KEY` is a Worker secret set in Cloudflare and is inherited on every deploy.

> **Do not rename** the `mikolaj` Worker, the `FamilyStore` class or the `family-v1` store name — that would detach the app from its existing data.

## Local development

There is nothing to install. Serve `public/` with any static server to work on the interface — the **demo family** on the landing page runs entirely in the browser without the API. Backend changes are best tested against the Worker's `FamilyStore` with an in-memory SQLite database (for example Node's built-in `node:sqlite`).
