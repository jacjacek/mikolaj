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
- **Change notices** — if a wish's title or budget changes after you reserved it, you see what it was before.
- **Demo family** — the landing page opens a fully working example family in the browser, with no account and nothing saved.

### People without a phone

Children or grandparents don't need an account. Anyone allowed to add people can create them and write their letter and wishes on their behalf; gifts for others are still reserved from the manager's own account. Later, a one-time link lets that person take over their list with their own e-mail and password.

### Several families, one account

One e-mail and password can belong to any number of families — say, your own and your in-laws'. In each family you have a separate letter, wishes and role, so you can organise one family and simply take part in another. Tap your name (next to *Wyloguj*) to switch families or start a new one. Opening an invitation while signed in adds that family to your account; on the join form, entering an existing e-mail with its password does the same. You can also leave a family yourself (*Opuść rodzinę* in the same menu) — except your only family, and not while you are its organiser: hand the role over first. Removing someone from a family, or leaving it, only removes them from that family; the account disappears with its last family. The daily and December e-mails arrive once per account, with a section for each family.

### For the family organiser

Whoever creates a family becomes its organiser and gets the **Rodzina** tab:

- renaming the family,
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

No e-mail ever reveals who is buying what for whom. The digest and the reminder carry a *don't send me these* link and can be switched back on from the menu under your name; invitations are limited per account and per day.

## Architecture

```
public/            frontend — plain HTML, CSS and ES-module JavaScript, no build step
  index.html       includes the pre-rendered landing page, so it paints before any JavaScript
  app.css          inlined into the HTML by the Worker (nonce'd <style>)
  app.js           the whole interface
  demo.js          the demo family — fetched only when someone opens it
  newsreader*.woff2   self-hosted serif: a preloaded core (Latin + Polish) and an -ext part for other
                   Latin letters, fetched only when such a character is on the page; body text uses the system font
  *.png, *.webp, favicon.ico, site.webmanifest   icons and web-app manifest
src/worker.js      Cloudflare Worker + one SQLite-backed Durable Object (FamilyStore)
wrangler.toml      the whole configuration of an installation
tests/security.mjs security regression tests against an in-memory SQLite database
scripts/verify_deployment.py   checks the live revision, every public file byte for byte, CSP and the API
.github/workflows/deploy.yml   push to master → tests → deploy → verify
```

- **Only the landing page is public.** Search engines may index `/` (robots.txt, sitemap, canonical, JSON-LD); everything else lives behind `/api/` (disallowed, `X-Robots-Tag: noindex`, login required) or after the `#` in the URL, which never reaches a server.
- **No dependencies and no bundler.** Files in `public/` are served by Cloudflare's static assets (ETags, compression); the Worker adds security headers and handles `/` and `/api/`. Icons and fonts are cached for a year, so a changed file needs a new name.
- **One response per action.** `GET /api/state` returns everything the signed-in person may see, already trimmed by the server; every write answers with the fresh state, so the client re-renders without asking again.
- **Many families, one store.** All families live in one Durable Object, every query is scoped by family, and families never see each other.
- **Additive migrations.** Schema changes are numbered, run once, and only add columns or tables; existing data is never removed.

## Security and privacy

- Passwords: PBKDF2-SHA256, 100,000 iterations, random salt.
- Sessions: random 256-bit token, only its hash is stored; `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Strict`, 90 days, renewed on use.
- Writes require the app's own `Origin` and a JSON body; requests are rate-limited per IP, sign-in attempts also per account.
- Strict Content-Security-Policy with a per-response script nonce.
- One-time links (invitations, password resets, account hand-over) carry 256-bit secrets in the URL fragment and are removed from the address bar on load.
- All permissions — ownership, managers, organiser mode — are checked on the server.
- Scheduled jobs call the Durable Object directly (RPC); they have no HTTP route.

## Run your own

You need a free Cloudflare account and Node.js; nothing is installed into the project.

1. Edit `[vars]` in `wrangler.toml`:
   - `APP_URL` — the address of your copy (leave empty to use the `*.workers.dev` address Cloudflare gives you),
   - `MAIL_FROM` — sender of e-mails, on a domain verified in [Resend](https://resend.com),
   - `OPEN_REGISTRATION` — `"true"` lets anyone on the internet start a family; anything else allows only the first family, and everyone else joins by invitation. For a private copy leave it empty.
2. Deploy:
   ```bash
   npx wrangler deploy
   ```
3. Optional — e-mail (password reset, invitations, digests). Without it the app works; a forgotten password then means a new invitation.
   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

Open the address, start your family, send the invitation link. To attach your own domain, add it to the Worker in the Cloudflare dashboard and set `APP_URL` to it.

## Deployment of list.do.mikolaja.pl

Every push to `master` goes through GitHub Actions: syntax check and security tests, `wrangler deploy`, then verification of `/version.json`, every file in `public/`, the CSP and the anonymous API. A failing test stops the deploy. The live revision is always at [`/version.json`](https://list.do.mikolaja.pl/version.json).

The workflow needs a `CLOUDFLARE_API_TOKEN` secret and the `CLOUDFLARE_ACCOUNT_ID` variable. Other domains pointing at the Worker redirect to `APP_URL`.

> **Do not rename** the `mikolaj` Worker, the `FamilyStore` class or the `family-v1` store name — that would detach the app from its existing data.

## Local development

```bash
npx wrangler dev
```

runs the whole app — frontend, API and a local database — at `http://localhost:8787`. Tests need only Node.js 22.5 or newer:

```bash
node tests/security.mjs
```

## License

[MIT](LICENSE)
