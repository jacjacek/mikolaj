# Mikołaj — family wishlist app

You own the entire visual/product design and frontend implementation in `public/index.html`, `public/app.css`, `public/app.js`, `public/favicon.svg` (vanilla HTML/CSS/JS ES modules; no dependencies or build). Hermes owns backend/deployment. All UI copy Polish with correct diacritics. Review https://intentapp.dev and https://bencho.dev using WebFetch for design inspiration, do not copy proprietary code/assets. Intent = typographic, disciplined, editorial, minimal; Bencho = tactile microinteractions. Think warm paper, ink, subtle red/coral or pine accent, beautiful typography, a bespoke animated envelope/letter motif, not a generic SaaS dashboard. Make strong design decisions. Generous but not wasteful whitespace, compact useful hero, no purple gradients. Design must work at 390px and desktop. Use original inline SVG illustrations. No external JS dependencies. Fonts system or Google fonts (CSP supports fonts.googleapis.com/fonts.gstatic.com). Prefers reduced motion respected. Touch targets 44px, visible focus, semantic accessible labels, dialog focus management, ESC, readable errors, loading and empty states.

## User story
Private family Christmas wishlists, not automatic pairing. Family members can write a short letter and add wishes with title, note, optional URL and price in PLN. Other members reserve individual gifts atomically to avoid duplicate purchases, can cancel or mark bought. The recipient must NEVER see reservation metadata, counts, or who reserved gifts. No self-reservation. Reusable on multiple devices via account email/password. Email is just a login identifier, no email delivery/reset yet: communicate that clearly. No fake live family data. Rich illustrative onboarding but real empty states.

## Pages/flows
- Landing/onboarding: sign in or create a family (family name, your name, email, password min 10 chars), or join via invitation URL `/#invite=TOKEN` (name/email/password). Family creation is gated by a private setup link `/#setup=TOKEN`; without it show login and invitation explanation, NOT public family signup. Read setup/invite from URL fragment, never query; remove fragment after successful registration.
- Logged in: family member list, own letter with edit/save, own wishlist CRUD (name, note, URL, price), other members' lists with reservation buttons, my reserved gifts view and purchased toggles. Nice navigation/topbar and mobile layout.
- Invitations: only admin can get invite URL; show/copy a link from API, optionally rotate it (confirm before rotation); explain private link. Don't leak invite on public pages.
- Logout. No delete family/account UI needed.
- Separate explicit privacy copy for own list: "Ktoś coś szykuje? Tego nie zdradzimy." not reveal actual states.

## Backend API contract (same origin, HttpOnly cookie)
All JSON; errors `{error: 'Polish human message'}` non-2xx. Fetch `credentials: 'same-origin'`, content-type application/json for bodies. Reject unexpected shapes gracefully. Use textContent/escape for ALL user content; validate URLs http/https and use rel=noopener noreferrer.

`GET /api/me` => `{user: null}` if anonymous, or `{user:{id,name,email,isAdmin},family:{id,name},members:[{id,name,letter,wishCount}]}`.
`POST /api/create` body `{setupToken,familyName,name,email,password}` => same as me.
`POST /api/join` body `{inviteToken,name,email,password}` => same as me.
`POST /api/login` body `{email,password}` => same as me.
`POST /api/logout` body `{}` => `{ok:true}`.
`PATCH /api/letter` body `{letter}` => `{ok:true}`.
`GET /api/members/:id/wishes` => `{member:{id,name,letter},wishes:[{id,ownerId,title,note,url,price,createdAt, ...reservation fields ONLY IF not your own}]}`. For other people: `{reserved:boolean,reservedByMe:boolean,purchased:boolean}`. No buyer identity disclosed.
`POST /api/wishes` body `{title,note,url,price}` => `{id}`. price numeric PLN or null.
`PATCH /api/wishes/:id` same body => `{ok:true}`. Only own.
`DELETE /api/wishes/:id` => `{ok:true}`. Only own. Confirm before deletion.
`POST /api/wishes/:id/reserve` body `{}` => `{ok:true}`. Conflict 409 => refresh and show error.
`DELETE /api/wishes/:id/reserve` => `{ok:true}`. Only reserver.
`PATCH /api/wishes/:id/reserve` body `{purchased:boolean}` => `{ok:true}`. Only reserver.
`GET /api/reservations` => `{wishes:[{id,ownerId,ownerName,title,note,url,price,purchased}]}`.
`GET /api/invite` admin only => `{url}`. `POST /api/invite` body `{}` rotates returns `{url}`.
`GET /api/invitation/:token` public => `{familyName}` or 404; use to personalize join form.

Refresh member list after changes via GET /api/me. Refresh on visibility return without interrupting forms; no fake optimistic success. Catch all network errors, disable in-flight buttons. API not implemented yet; DO NOT implement backend or mock persistence. You may add a frontend fixture page under tests/ for screenshots, but never serve fake content as real.

## Host restrictions
This is Mikrus control-plane: DO NOT install dependencies, run npm/npx/node, build/bundle/lint/typecheck, or start ANY server. Read and write source only. GitHub hosted CI does runtime checks. You may use Read,Write,Edit,Glob,Grep,WebFetch. DO NOT git commit/push. Do not touch other /srv projects.

Deliver completed production-quality frontend, not a plan. Report design decisions briefly and any known gaps. No stubs or inert buttons.
