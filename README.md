# Mikołaj

Prywatne, rodzinne listy do Świętego Mikołaja. Każda osoba pisze list i dodaje życzenia. Bliscy mogą rezerwować prezenty, oznaczać je jako kupione i anulować własne rezerwacje. Autor listy nigdy nie otrzymuje informacji o rezerwacjach — także w odpowiedzi API.

## Tryb domyślny: podgląd UX bez logowania

Na czas pracy nad UX adres główny (`/` i trasy `#/…`) otwiera od razu **przykładową, fikcyjną rodzinę** (Ania, Bartek, Marta, Tomek) — bez konta, hasła ani ekranu logowania. Pasek „Podgląd UX · dane przykładowe” pozwala przełączać osobę („Podgląd jako”) i przywrócić stan początkowy („Od nowa”, z potwierdzeniem).

- Podgląd działa w całości w przeglądarce (`public/demo.js`): nie wywołuje prawdziwego API, nie tworzy ani nie usuwa sesji na serwerze i nie ma dostępu do danych prawdziwej rodziny.
- Zmiany zapisują się tylko na tym urządzeniu, w tej przeglądarce, pod kluczem localStorage `mikolaj.ux-demo.v1`. Nie trafiają do rodziny. Gdy localStorage jest niedostępny, stan żyje tylko w bieżącej karcie (pasek o tym informuje); uszkodzony zapis jest zastępowany danymi przykładowymi bez ruszania innych kluczy.
- Lokalnie obowiązują te same reguły co w backendzie: limity pól, brak rezerwacji własnych życzeń, jedna rezerwacja na prezent, zmiany tylko własnej listy i własnych rezerwacji, brak informacji o rezerwacjach na własnej liście, migawki z chwili rezerwacji.
- Logowanie i zaproszenia są w podglądzie wyłączone (przycisk wylogowania i zakładka „Zaproś” są ukryte).

**Prawdziwa, chroniona aplikacja (tryb live)** jest dostępna pod `/?live=1` oraz automatycznie po otwarciu linku `#setup=…` lub `#invite=…`. Autoryzacja po stronie serwera nie zmieniła się — podgląd jej nie omija, bo w ogóle nie korzysta z API. Wszystko poniżej opisuje tryb live.

## Architektura

- Frontend: HTML, CSS i JavaScript bez zależności ani procesu budowania. Design przygotowany z Claude Code / Opus 5.5.
- Backend: Cloudflare Worker, Web Crypto, SQLite-backed Durable Object.
- W trybie live dane znajdują się w Cloudflare, nie w localStorage i nie na Mikrusie. (localStorage służy wyłącznie danym przykładowym podglądu UX.)
- Jedna rodzina na instalację. Utworzenie rodziny wymaga prywatnego, jednorazowo używanego linku startowego. Administrator zaprasza kolejnych członków osobnym linkiem, który może unieważnić.
- E-mail jest identyfikatorem logowania. Aplikacja nie wysyła wiadomości, nie weryfikuje adresów i nie ma automatycznego resetu hasła.
- To listy i rezerwacje, nie losowanie par Secret Santa.

## Bezpieczeństwo

Hasła są haszowane PBKDF2-SHA256 z losową solą i 100 000 iteracji. Sesje: losowe tokeny 256-bit, zapisany wyłącznie hash, ważność 30 dni, cookie `__Host-mikolaj` z HttpOnly/Secure/SameSite=Strict. Operacje zapisu sprawdzają Origin i typ danych. Kontrola właściciela oraz rezerwującego jest po stronie backendu. Jednoczesne próby rezerwacji rozstrzyga atomowo Durable Object; drugi kupujący dostaje 409. Obowiązują limity prób logowania i zapisów oraz limity rozmiarów pól. Zaproszenia mają 256 bitów entropii; sekret jest przekazywany we fragmencie URL, a odpowiedzi API nie są cache'owane.

Nie udostępniaj linku startowego ani zaproszenia publicznie. Nigdy nie dodawaj `.env`, plików bootstrap ani testowych sesji do repozytorium.

## Wdrożenie bez budowania na Mikrusie

Nie instaluj zależności, nie uruchamiaj npm/npx/node, bundlera ani lokalnego serwera. `scripts/deploy.py` przesyła nieprzetworzone moduły źródłowe do Cloudflare API; nie kompiluje aplikacji.

Wymagany `CLOUDFLARE_API_TOKEN` w bezpiecznym środowisku, z uprawnieniami Workers Scripts Edit dla konta oraz Zone Read/DNS Edit/Workers Routes Edit dla wskazanej strefy. Nie przekazuj wartości tokenu w argumentach polecenia ani w repozytorium.

```sh
# Oddzielny Worker i oddzielna przestrzeń danych, bez domeny produkcyjnej:
python scripts/deploy.py --account "$CLOUDFLARE_ACCOUNT_ID" --zone "$CLOUDFLARE_ZONE_ID" --preview

# Wyłącznie po zatwierdzeniu podglądu; jedyna obsługiwana domena:
python scripts/deploy.py --account "$CLOUDFLARE_ACCOUNT_ID" --zone "$CLOUDFLARE_ZONE_ID"
```

Skrypt sprawdza domenę i konto, nie nadpisuje istniejących obcych rekordów DNS i odczytuje konfigurację po zapisie. Przy pierwszym wdrożeniu tworzy sekret SETUP_TOKEN i **przed uploadem** trwale zapisuje prywatny plik bootstrap (0600) poza repozytorium, w `~/.local/share/mikolaj/bootstrap/`. Ponowienie po przerwaniu wdrożenia używa tego samego sekretu. Przy aktualizacji zachowuje sekret i przestrzeń SQLite. Link startowy to `https://mikolaj.walasek.xyz/#setup=...` — nie umieszczaj go w publicznej dokumentacji. Jeśli link startowy został utracony przed utworzeniem rodziny, świadoma operacja `--rotate-setup-token` tworzy nowy link (poprzedni przestaje działać); nie resetuje kont ani danych.

**Nie zmieniaj nazwy Workera, klasy FamilyStore ani produkcyjnego identyfikatora `family-v1` po zapisaniu danych.** Nie usuwaj namespace Durable Objects. Zmiana tych identyfikatorów może odłączyć aplikację od istniejącej rodziny.

## Testy na wdrożonym podglądzie

```sh
python tests/live_api.py https://mikolaj-preview.SUBDOMAIN.workers.dev /sciezka/do/prywatnego/bootstrap.json
```

Testy tworzą jednorazową rodzinę i konta testowe w pustym podglądzie; skrypt odmawia działania na domenie produkcyjnej. Weryfikują logowanie, listy, autoryzację, CSRF, niebezpieczne URL, wyścig rezerwacji, anulowanie, status zakupów, rotację zaproszeń i brak ujawnienia rezerwacji autorowi listy. Testowych sesji nie wolno publikować.

Te testy dotyczą tylko API trybu live; podgląd UX nie ma automatycznych testów. Widok mobilny i główne interakcje (w podglądzie oraz pod `/?live=1`) sprawdzaj w prawdziwej przeglądarce na wdrożonym podglądzie przed publikacją na domenie głównej. Samo powodzenie uploadu nie oznacza sprawdzonej aplikacji.
