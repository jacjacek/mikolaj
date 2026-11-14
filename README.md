# Mikołaj

Prywatne, rodzinne listy do Świętego Mikołaja. Każdy może założyć własną rodzinę (zostaje jej organizatorem) i zaprosić bliskich linkiem; rodziny są od siebie oddzielone. W rodzinie: każdy pisze list i dodaje życzenia, bliscy rezerwują prezenty tak, żeby się nie dublować. Obdarowany nigdy nie widzi rezerwacji na swojej liście — także w odpowiedzi API.

## Jak działa

- **Listy** — rozwijane osoby z listem i życzeniami (od najtańszych), „Kupię to” rezerwuje prezent.
- **Kupuję** — prezenty, które wybrałem dla innych, pogrupowane według obdarowanych; odhaczanie kupionych.
- **Moje** — mój list i życzenia, a także osoby, które prowadzę (dziecko bez telefonu, dziadkowie). Opiekun pisze za nie list i życzenia; prezenty dla innych rezerwuje na swoim koncie. Może przekazać tej osobie jej listę jednorazowym linkiem (ustawia e-mail i hasło).
- **Rodzina** (tylko organizator) — kto co komu kupuje (bez listy organizatora), link zaproszenia, osoby: link do nowego hasła, uprawnienie do dodawania osób, zmiana opiekuna, przekazanie roli, usuwanie.
- **Tryb organizatora** — włączany ręcznie, tylko w bieżącej sesji i na godzinę (pilnuje tego serwer): organizator edytuje listy i życzenia innych i przypisuje za nich prezenty. Jego własna lista dalej jest przed nim ukryta. W zakładce Rodzina można też hurtowo dodać osoby bez konta.
- Życzenia mają przedział budżetowy zamiast ceny: Drobnostki (do 50 zł), Nie było niegrzecznie (50–200 zł), To był grzeczny rok (200–300 zł), Byłem aniołkiem (bez limitu).

## Kod

- `public/` — `index.html`, `app.css`, `app.js` (bez zależności i budowania).
- `src/worker.js` — Cloudflare Worker + Durable Object na SQLite. Migracje dodają kolumny przy starcie, nie usuwają danych.
- `scripts/` — wdrożenie (`deploy.py`), weryfikacja (`verify_deployment.py`), ochrona przed nieaktualnym przebiegiem (`branch_head_guard.py`).

Hasła: PBKDF2-SHA256 (100 000 iteracji). Sesje: losowy token, w bazie tylko hash, cookie `__Host-mikolaj` HttpOnly/Secure/SameSite=Strict. Zapis wymaga własnego Origin i JSON. Uprawnienia sprawdza backend.

## Wdrożenie

Push do `master` → https://list.do.mikolaja.pl (stary adres mikolaj.walasek.xyz przekierowuje), push do `develop` → https://mikolaj-preview.jac3k.workers.dev (osobne dane). Workflow `.github/workflows/deploy.yml` sprawdza składnię, wgrywa źródła i weryfikuje wdrożenie. Wersja: `/version.json`.

Maile (Resend, nadawca listdo@mikolaja.pl): link do nowego hasła, zaproszenie od organizatora, codziennie w południe przypomnienie o prezentach, które wybrałeś do kupienia, i nowe (wolne) życzenia od bliskich i przypomnienie 3 grudnia. Nigdy nie zdradzają, co kto komu kupuje. **Nie zmieniaj nazwy Workera, klasy `FamilyStore` ani identyfikatora `family-v1`** — odłączyłoby to aplikację od istniejących danych.
