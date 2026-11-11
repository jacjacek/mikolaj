# Mikołaj

Prywatne, rodzinne listy do Świętego Mikołaja: każdy pisze list i dodaje życzenia, bliscy rezerwują prezenty tak, żeby się nie dublować. Obdarowany nigdy nie widzi rezerwacji na swojej liście — także w odpowiedzi API.

## Jak działa

- **Listy** — rozwijane osoby z listem i życzeniami (od najtańszych), „Kupię to” rezerwuje prezent.
- **Moje** — co kupuję, mój list i życzenia, a także osoby, które prowadzę (dziecko bez telefonu, dziadkowie). Opiekun pisze za nie list i życzenia; prezenty dla innych rezerwuje na swoim koncie. Może dać takiej osobie własne konto jednorazowym linkiem.
- **Rodzina** (tylko organizator) — kto co komu kupuje (bez listy organizatora), link zaproszenia, osoby: link do nowego hasła, uprawnienie do dodawania osób, zmiana opiekuna, przekazanie roli, usuwanie.
- Życzenia mają przedział budżetowy zamiast ceny: Drobnostki (do 50 zł), Nie było niegrzecznie (50–200 zł), To był grzeczny rok (200–300 zł), Byłem aniołkiem (bez limitu).

## Kod

- `public/` — `index.html`, `app.css`, `app.js` (bez zależności i budowania).
- `src/worker.js` — Cloudflare Worker + Durable Object na SQLite. Migracje dodają kolumny przy starcie, nie usuwają danych.
- `scripts/` — wdrożenie (`deploy.py`), weryfikacja (`verify_deployment.py`), ochrona przed nieaktualnym przebiegiem (`branch_head_guard.py`).

Hasła: PBKDF2-SHA256 (100 000 iteracji). Sesje: losowy token, w bazie tylko hash, cookie `__Host-mikolaj` HttpOnly/Secure/SameSite=Strict. Zapis wymaga własnego Origin i JSON. Uprawnienia sprawdza backend.

## Wdrożenie

Push do `master` → https://mikolaj.walasek.xyz, push do `develop` → https://mikolaj-preview.jac3k.workers.dev (osobne dane). Workflow `.github/workflows/deploy.yml` sprawdza składnię, wgrywa źródła i weryfikuje wdrożenie. Wersja: `/version.json`.

Pierwsze utworzenie rodziny wymaga prywatnego linku `#setup=…` (patrz `scripts/deploy.py`). **Nie zmieniaj nazwy Workera, klasy `FamilyStore` ani identyfikatora `family-v1`** — odłączyłoby to aplikację od istniejących danych.
