# Mikołaj

Prywatne, rodzinne listy do Świętego Mikołaja. Każda osoba pisze list i dodaje życzenia. Bliscy mogą rezerwować prezenty, oznaczać je jako kupione i anulować własne rezerwacje. Autor listy nigdy nie otrzymuje informacji o rezerwacjach — także w odpowiedzi API.

## Tryb domyślny: podgląd UX bez logowania

Na czas pracy nad UX adres główny (`/` i trasy `#/…`) otwiera od razu **przykładową, fikcyjną rodzinę** (Ania, Bartek, Marta, Tomek) — bez konta, hasła ani ekranu logowania. Narzędzia podglądu siedzą w nagłówku: pod nazwą „Mikołaj” widać „Podgląd · zapis lokalny”, natywna lista wyboru przełącza osobę, a menu „⋯” wyjaśnia tryb i pozwala przywrócić dane przykładowe (z potwierdzeniem).

## Wygląd i UX

Minimalistyczny świąteczny interfejs: ciepła biel `#f8f6f0`, sosnowa zieleń `#214537` i bordowy akcent `#8a3444`. Szeryfowy Newsreader w nagłówkach i liście, Lato w obsłudze aplikacji. Zamiast zestawu zaokrąglonych kart — spokojne wiersze, cienkie podziały i mniejsze, bardziej użytkowe tytuły prezentów. Autorski znak drewnianej werandy z gwiazdą i rozświetlonym oknem oraz delikatny fryz odwołują się do świdermajerów linii otwockiej; nie są kopią wzoru z fotografii ani deklaracją ustalonego miejsca Wigilii.

Znak i fryz pojawiają się raz po otwarciu aplikacji. Osoby i szczegóły prezentów płynnie rozwijają się i zwijają; przejścia można przerwać kolejnym kliknięciem. Natywne `details` zachowują zwykłe działanie w starszych przeglądarkach, bez zależności od obsługi nowych animacji CSS. `prefers-reduced-motion` usuwa opóźnienia i skraca animacje. Bez padającego śniegu, animacji w pętli, pergaminowych tekstur i dodatkowego dużego banera.

- Dokładnie **dwie zakładki**: **Listy** (`#/`) i **Moje** (`#/moje`). Zaproszenia pozostają narzędziem administratora, nie trzecią zakładką.
- **Listy**: zwijane/rozwijane osoby, a w środku ich list i zwijane szczegóły każdego prezentu. Dane listy są pobierane dopiero po rozwinięciu osoby. Można rozwinąć kilka osób niezależnie; rezerwacja i zakup nie zwijają otwartych elementów. Cena i status prezentu są widoczne również po zwinięciu. Filtr dostępności działa niezależnie dla każdej osoby.
- **Moje**: własny list, własne życzenia i rezerwacje prezentów z list innych osób na jednej stronie. Skrót w nagłówku przewija do rezerwacji; zakup i rezygnacja działają bez dodatkowej zakładki. Stan rezerwacji otrzymywanych prezentów pozostaje niewidoczny w sekcji własnych życzeń.
- Gdy brakuje własnego listu lub życzeń, na górze List pojawia się dopasowany komunikat z przejściem do Moje. Puste własne życzenia mają dodawanie pierwszego prezentu, pusty list ma pisanie, puste rezerwacje kierują do List. Pusta lista innej osoby pozwala wrócić do pozostałych osób, bez oferowania niedozwolonej edycji.
- Stare adresy `#/moja-lista` i `#/rezerwacje` kierują do Moje; `#/osoba/ID` otwiera odpowiednią osobę w Listach. Widok bez logowania oraz istniejący klucz lokalnego zapisu są zachowane.
- Nawigacja: na telefonie dolny pasek z ikonami i podpisami, na komputerze tekstowe zakładki w nagłówku. Ruch ograniczony do krótkich przejść; respektowane `prefers-reduced-motion`.

- Podgląd działa w całości w przeglądarce (`public/demo.js`): nie wywołuje prawdziwego API, nie tworzy ani nie usuwa sesji na serwerze i nie ma dostępu do danych prawdziwej rodziny.
- Zmiany zapisują się tylko na tym urządzeniu, w tej przeglądarce, pod kluczem localStorage `mikolaj.ux-demo.v1`. Nie trafiają do rodziny. Gdy localStorage jest niedostępny, stan żyje tylko w bieżącej karcie (nagłówek pokazuje wtedy „Podgląd · tylko ta karta”); uszkodzony zapis jest zastępowany danymi przykładowymi bez ruszania innych kluczy.
- Lokalnie obowiązują te same reguły co w backendzie: limity pól, brak rezerwacji własnych życzeń, jedna rezerwacja na prezent, zmiany tylko własnej listy i własnych rezerwacji, brak informacji o rezerwacjach na własnej liście, migawki z chwili rezerwacji.
- Logowanie i zaproszenia są w podglądzie wyłączone (przycisk wylogowania i zakładka „Zaproś” są ukryte).

**Prawdziwa, chroniona aplikacja (tryb live)** jest dostępna pod `/?live=1` oraz automatycznie po otwarciu linku `#setup=…` lub `#invite=…`. Autoryzacja po stronie serwera nie zmieniła się — podgląd jej nie omija, bo w ogóle nie korzysta z API. Wszystko poniżej opisuje tryb live.

## Architektura

- Frontend: HTML, CSS i JavaScript bez zależności ani procesu budowania. Pierwotny projekt powstał z pomocą Claude Code; bieżący kierunek świąteczny opisuje `FALENICA_DESIGN_BRIEF.md`.
- Backend: Cloudflare Worker, Web Crypto, SQLite-backed Durable Object.
- W trybie live dane znajdują się w Cloudflare, nie w localStorage i nie na Mikrusie. (localStorage służy wyłącznie danym przykładowym podglądu UX.)
- Jedna rodzina na instalację. Utworzenie rodziny wymaga prywatnego, jednorazowo używanego linku startowego. Administrator zaprasza kolejnych członków osobnym linkiem, który może unieważnić.
- E-mail jest identyfikatorem logowania. Aplikacja nie wysyła wiadomości, nie weryfikuje adresów i nie ma automatycznego resetu hasła.
- To listy i rezerwacje, nie losowanie par Secret Santa.

## Bezpieczeństwo

Hasła są haszowane PBKDF2-SHA256 z losową solą i 100 000 iteracji. Sesje: losowe tokeny 256-bit, zapisany wyłącznie hash, ważność 30 dni, cookie `__Host-mikolaj` z HttpOnly/Secure/SameSite=Strict. Operacje zapisu sprawdzają Origin i typ danych. Kontrola właściciela oraz rezerwującego jest po stronie backendu. Jednoczesne próby rezerwacji rozstrzyga atomowo Durable Object; drugi kupujący dostaje 409. Obowiązują limity prób logowania i zapisów oraz limity rozmiarów pól. Zaproszenia mają 256 bitów entropii; sekret jest przekazywany we fragmencie URL, a odpowiedzi API nie są cache'owane.

Nie udostępniaj linku startowego ani zaproszenia publicznie. Nigdy nie dodawaj `.env`, plików bootstrap ani testowych sesji do repozytorium.

## Repozytorium i automatyczne wdrożenia

Cały kod aplikacji, backend, testy i skrypty wdrożeniowe znajdują się w prywatnym repozytorium **https://github.com/jacjacek/mikolaj**. Dane prawdziwej rodziny pozostają w Cloudflare, a sekrety i prywatne pliki bootstrap są poza Gitem.

| Push do gałęzi | Automatyczny adres |
| --- | --- |
| `master` — główna gałąź wydaniowa | https://mikolaj.walasek.xyz/ |
| `develop` — prace i podgląd | https://mikolaj-preview.jac3k.workers.dev/ |

Z innego komputera lub narzędzia:

```sh
git clone git@github.com:jacjacek/mikolaj.git
cd mikolaj
git switch master
# Zmień pliki, następnie:
git add <zmienione-pliki>
git commit -m "Opis zmiany"
git push origin master
```

Push sam uruchamia `.github/workflows/deploy.yml` — nie potrzeba ręcznej komendy deploy ani dostępu do Mikrusa. Dla zmian roboczych użyj `develop`; opublikowanie ich na głównej domenie wymaga merge/pushu do `master`. Każda gałąź ma osobną kolejkę wdrożeń. Bezpośrednio przed uploadem sprawdzany jest aktualny HEAD gałęzi: ponowienie starego przebiegu jest pomijane i nie cofa nowszej wersji. Świadome cofnięcie zmian wykonuj przez `git revert` i nowy push.

Wyjątek platformy GitHub: push wykonany przez wbudowany `GITHUB_TOKEN` innego workflow nie uruchamia automatycznie kolejnych workflowów. Takie automatyzacje powinny użyć odpowiedniego tokenu aplikacji/PAT albo jawnego `workflow_dispatch`. Zwykły push przez SSH, edycja w GitHubie i commity narzędzi korzystających z własnego uwierzytelnienia uruchamiają wdrożenie normalnie.

GitHub Actions na hosted runnerze uruchamia testy zabezpieczeń deployu i kontrolę składni JS, przesyła surowe moduły do istniejącego Workera, a następnie sprawdza publiczną wersję, dokładne bajty frontendu, CSP i anonimową ochronę API. Nie wykonuje budowania aplikacji na Mikrusie. Zielony przebieg zawiera sprawdzony adres i SHA commita.

Aktualna wersja jest pod **`/version.json`** na obu adresach (`revision` = pełny SHA, `branch` = gałąź). Odpowiedź ma `no-store`, a HTML i moduły wymagają ponownej walidacji cache. Po zakończonym workflow odśwież otwartą kartę — aplikacja celowo nie przeładowuje jej samoczynnie podczas pisania listu.

Repozytorium ma jeden Actions secret `CLOUDFLARE_API_TOKEN` i dwie zmienne `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ZONE_ID`. Poświadczenie GitHuba nie jest kopiowane do repozytorium ani workflow. CI używa `--ci`, dziedziczy `SETUP_TOKEN`, sprawdza niezmieniony namespace `FAMILY` i nie tworzy bootstrapu, migracji, DNS ani nowego przypięcia domeny. Baza, sesje i istniejące linki pozostają w tej samej instalacji. Nie zmieniaj identyfikatorów storage przy zwykłych zmianach frontendu.

## Awaryjne wdrożenie źródłowe bez budowania

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

Testy powyżej dotyczą API trybu live. Regresje podglądu UX sprawdza `tests/ui_two_tabs.py`: 33 podstawowe kontrole na zdalnym wdrożeniu, na świeżym profilu Chromium (`tests/ui_minimal.py` pozostaje zgodnym wstecznie punktem wejścia). `MIKOLAJ_QA_SEASONAL=1` rozszerza przebieg do **40 kontroli**, dodając paletę, kontrast przycisku, rzeczywisty ruch otwierania i zamykania przy 10% prędkości, szybkie przełączanie oraz ograniczenie ruchu. `MIKOLAJ_QA_THEME_ONLY=1` uruchamia tylko kontrole sezonowe.

Test wymaga już dostępnych Chromium i Python `websockets`; nie instaluje zależności aplikacji i nie uruchamia lokalnego serwera. `CHROMIUM_EXECUTABLE` wskazuje istniejącą przeglądarkę, `MIKOLAJ_QA_OUTPUT` opcjonalny katalog raportu, a argument skryptu opcjonalny adres wdrożenia (domyślnie izolowany preview). Bieżący raport: `tests/results/falenica-preview.json`; wcześniejsze raporty dotyczą wcześniejszych wersji. Widok mobilny i główne interakcje sprawdzaj na wdrożonym podglądzie przed publikacją na domenie głównej. Samo powodzenie uploadu nie oznacza sprawdzonej aplikacji.
