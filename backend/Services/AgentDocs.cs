namespace Mise.Api.Services;

/// <summary>
/// Single source of every piece of agent-facing text: the exported AGENTS.md /
/// CLAUDE.md, the api.md reference, the slash-command files and the copyable
/// "connect an agent" prompts shown on the Profile screen. Texts use the
/// {API} / {CTX} / {REPO} tokens (replaced here or client-side) so JSON examples
/// don't fight C# string interpolation.
/// </summary>
public static class AgentDocs
{
    public const string ContextDirToken = "{{CONTEXT_DIR}}";
    public const string RepoDirToken = "{{REPO_DIR}}";

    public static string AgentsMd(string apiBase) => """
        # Pichci — instrukcje dla asystenta kulinarnego

        Pomagasz planować i gotować posiłki z tej kuchni. Ten folder to Twoja pamięć kulinarna.

        ## Najpierw przeczytaj (w tej kolejności)

        1. `cookbook.md` — gospodarstwo, sprzęt, umiejętności, smaki, profil szczegółowy i zasady.
        2. `pantry.json` — katalog składników z ilościami liczbowymi (`ilosc` w jednostce
           `jednostka`: g / ml / szt; `ilosc: 0` = brak w domu). Nigdy nie proponuj dania,
           które wymaga czegoś, czego nie ma, bez oznaczenia tego jako „do kupienia".
        3. `plan.md` — co jest zaplanowane na ten i przyszły tydzień.
        4. `cooklog.md` — co ostatnio gotowaliśmy i jak wyszło; traktuj notatki jako feedback.
        5. `recipes/` — zapisane przepisy do wykorzystania lub adaptacji.

        ## Zapisywanie — wyłącznie przez REST API

        Pliki w tym folderze są **generowane przez aplikację i nadpisywane przy każdej
        zmianie danych — niczego tu nie edytuj ani nie dodawaj**. Wszystkie zapisy wykonuj
        przez API pod `{API}` (aplikacja musi działać: `docker compose up`). **Zapisy
        wymagają nagłówka `X-Api-Key`** — wartość to `MISE_API_KEY` z pliku `.env`
        aplikacji; szczegóły i przykład w `api.md`:

        - nowy przepis: `POST {API}/recipes`
        - zakupy → spiżarnia (delty, np. po paragonie): `POST {API}/pantry/adjust`
        - inwentaryzacja spiżarni (ilości absolutne): `POST {API}/pantry/bulk`
        - nowa pozycja katalogu spiżarni (świadomie, rzadko): `POST {API}/pantry`
        - plan tygodnia: `PUT {API}/plan/entry`
        - odnotowanie ugotowanego dania (+ zdjęcie składników ze stanu): `POST {API}/cooklog`
        - pozycja na liście zakupów: `POST {API}/shopping`

        Pełna dokumentacja endpointów i schematów JSON z przykładami `curl`: **`api.md`**.
        Po udanym zapisie aplikacja sama odświeża pliki w tym folderze.

        ## Typowe zadania

        ### Przepis ze zdjęcia (lub tekstu / strony)
        1. Obejrzyj zdjęcie / przeczytaj źródło samodzielnie i wyciągnij przepis.
        2. Znormalizuj do schematu z `api.md`: tytuł, czas w minutach, porcje, składniki
           `{ "name", "quantity", "displayText", "amountValue", "amountUnit" }` po polsku, kroki jako lista
           zdań. Oszacuj też wartości odżywcze NA PORCJĘ (`kcal`, `protein`, `fat`, `carbs`)
           — zawsze wszystkie cztery (nigdy samo `kcal` — resztę policz ze składników),
           tak jak `dishType` i `usesAirFryer`. Tytuł to nazwa dania, nie lista elementów
           posiłku („Jajecznica; pieczywo; gruszka" ✗). `name` to kanoniczny produkt
           katalogu spiżarni, `quantity` to sama ilość pokazywana po prawej, a `displayText`
           zachowuje oryginalny wiersz ze źródła jako doprecyzowanie pod nazwą. Przy imporcie
           ze strony, zdjęcia lub książki zawsze ustaw `displayText`, jeśli źródło zawiera
           dodatkowe informacje ponad prostą ilość i nazwę.
           Nazwy składników w mianowniku,
           jak mówi się w kuchni („Jajka" + „2 szt.", nie „Jaja kurze całe" + „100 g";
           „Miód", nie „Miodu"). Jeden produkt = jeden składnik (rozbijaj „Sól, pieprz
           i zioła" na osobne pozycje; przymiotniki tylko gdy odróżniają produkt).
           `source`: `"web"` dla zdjęcia z książki lub strony, `"ai"` dla własnej kreacji,
           `"manual"` dla rodzinnych notatek.

           **Precyzja jest obowiązkowa.** Składniki, kroki i wskazówki nie mogą zawierać
           pustych ilości ani zwrotów typu „do smaku", „szczypta", „odrobina", „garść",
           „kilka" lub „według instrukcji na opakowaniu" bez konkretnej wartości. Gdy
           źródło jest nieprecyzyjne, dobierz rozsądną stałą ilość dla bazowej liczby
           porcji i zapisz ją w g / ml / szt. razem z `amountValue` i `amountUnit`
           (np. sól `2 g`, pieprz `0,5 g`). Każdy etap obróbki ma podawać liczbowy czas,
           temperaturę albo poziom ognia; samo „aż zgęstnieje" lub „do miękkości" nie
           wystarcza. Jeśli efekt może zależeć od sprzętu, podaj czas oraz sprawdzalny
           punkt końcowy (np. `8 minut, do 74°C w środku`). Prawdziwe zamienniki mogą
           pozostać, ale każda opcja musi mieć własną dokładną ilość.
        3. Porównaj składniki z `pantry.json`; jeśli czegoś brakuje, zaproponuj zamianę
           pasującą do naszej kuchni albo oznacz do kupienia.
        4. Pokaż mi propozycję. Po akceptacji: `POST {API}/recipes`, a brakujące składniki
           dodaj przez `POST {API}/recipes/{id}/add-missing-to-shopping`.

        ### Paragon → spiżarnia + lista zakupów
        1. Wyciągnij produkty spożywcze z ilościami w jednostkach metrycznych (g / ml / szt)
           i **zmapuj je na pozycje katalogu** (nazwy i aliasy w `pantry.json`): paragon mówi
           „BUŁKA KAJZERKA", katalog ma „Pieczywo" — wysyłaj nazwę katalogową. Pomiń chemię
           i inne produkty niespożywcze.
        2. Jedno `POST {API}/pantry/adjust` z deltami (ile DOSZŁO). Pozycje z `notInCatalog`
           NIE zostały zapisane — zdecyduj per pozycja:
           - wariant czegoś z katalogu → dodaj alias (`PUT {API}/pantry/{id}` z rozszerzonym
             `aliases`), żeby następnym razem dopasowało się samo, i ponów adjust;
           - nowy stały produkt tej kuchni → `POST {API}/pantry` (z `unit` i `category`);
           - jednorazowy zakup → pomiń.
        3. Sprawdź `GET {API}/shopping` i odhacz kupione pozycje
           (`PATCH {API}/shopping/{id}/check` z `{ "checked": true }`) lub usuń je
           (`DELETE {API}/shopping/{id}`).

        ### Zdjęcie lodówki / inwentaryzacja
        Jak wyżej, ale ilości są absolutne (ile JEST) — użyj `POST {API}/pantry/bulk`.

        ### Ugotowane danie
        `POST {API}/cooklog` z oceną/notatką; dołącz `deductions` (ile składników zeszło,
        policz z przepisu; pomiń składniki o niezgodnej jednostce), by spiżarnia została
        automatycznie pomniejszona.

        ### Plan tygodnia
        1. Przeczytaj `plan.md`, `cooklog.md` (nie powtarzaj świeżo gotowanych dań) i `recipes/`.
        2. Zapisuj `PUT {API}/plan/entry` dzień po dniu (sloty: `breakfast` / `lunch` / `dinner`).
        3. Na koniec `POST {API}/plan/add-missing-to-shopping` i podsumuj, co trzeba dokupić.

        ## Zasady

        Domyślna liczba porcji, preferencje sprzętowe, ostrość, budżet itd. — patrz
        `cookbook.md`, sekcje „Zasady dla asystenta" i „Profil szczegółowy (ankieta)".
        Przy każdej propozycji wskaż wszystko, co trzeba dokupić.
        """.Replace("{API}", apiBase);

    public static string ApiMd(string apiBase) => """
        # Pichci — REST API dla agentów

        Baza: `{API}`. Aplikacja musi działać (`docker compose up`). JSON w UTF-8,
        daty w formacie `YYYY-MM-DD`, identyfikatory to GUID-y.
        Każdy udany zapis automatycznie regeneruje pliki w folderze `context/`.

        ## Uwierzytelnianie

        Odczyty (GET) są otwarte. **Każdy zapis (POST/PUT/PATCH/DELETE) oraz `GET /chat/*`,
        `GET /context/status` i `GET /context/connect` wymagają nagłówka `X-Api-Key`**
        o wartości ze zmiennej `MISE_API_KEY` aplikacji (plik `.env` obok docker-compose):

        ```bash
        curl -X POST {API}/shopping -H "X-Api-Key: $MISE_API_KEY" \
          -H "Content-Type: application/json" -d '{ "name": "Masło" }'
        ```

        Dodawaj ten nagłówek do wszystkich przykładów zapisu poniżej. Brak lub zły
        klucz → `401`. (Ludzie w przeglądarce logują się kontem Google — agentów to
        nie dotyczy; serwer MCP czyta klucz ze zmiennej środowiskowej `MISE_API_KEY`.)

        ## Słowniki

        | pole | wartości |
        |---|---|
        | `source` (przepis) | `ai` — Twoja kreacja · `web` — książka/strona · `manual` — własne |
        | `dishType` (przepis) | `breakfast` — śniadanie · `main` — danie główne · `soup` — zupa · `salad` — sałatka · `side` — dodatek · `dessert` — deser · `snack` — przekąska · `baking` — wypieki |
        | `cuisine` (przepis) | `polish` · `italian` · `french` · `spanish` · `greek` · `mediterranean` · `middleeastern` · `indian` · `thai` · `vietnamese` · `chinese` · `japanese` · `korean` · `mexican` · `american` · `other` |
        | `category` (spiżarnia) | `produce` — warzywa i owoce · `fridge` — lodówka · `pantry` — spiżarnia · `spices` — przyprawy |
        | `unit` (spiżarnia/składniki) | `g` — gramy · `ml` — mililitry · `szt` — sztuki |
        | `slot` (plan) | `breakfast` · `lunch` · `dinner` |

        Status spiżarni (`in` — jest · `low` — mało · `out` — brak) jest **wyliczany z ilości**
        (0 → `out`, poniżej progu → `low`) — nie da się go ustawić wprost; ustawia się ilości.

        `dishType` i `cuisine` są opcjonalne, ale **zawsze je ustawiaj przy dodawaniu przepisu**
        — napędzają filtry w bibliotece. Nieznana wartość → `400` z listą dozwolonych.

        `usesAirFryer` (bool) — **zawsze ustawiaj przy dodawaniu przepisu**: `true`, gdy danie
        przygotowuje się we frytkownicy beztłuszczowej (ulubiony sprzęt użytkownika), inaczej
        `false`. Pominięte/`null` = aplikacja zgaduje z tekstu przepisu (mniej przewidywalne).

        `kcal` (int), `protein`, `fat`, `carbs` (liczby, gramy) — szacunkowe wartości odżywcze
        **NA JEDNĄ PORCJĘ**, nie na całe danie. **Zawsze oszacuj je przy dodawaniu przepisu**
        (policz ze składników i liczby porcji; wystarczy rozsądne przybliżenie) — napędzają
        podsumowania kalorii w planie tygodnia. `null`/pominięte = jeszcze nie oszacowane
        (starsze przepisy). **Zawsze komplet czterech wartości, nigdy samo `kcal`** — gdy
        źródło (np. jadłospis) podaje tylko kalorie, oszacuj białko/tłuszcz/węglowodany
        ze składników.

        ## Przepisy

        ### POST /recipes — dodaj przepis
        ```bash
        curl -X POST {API}/recipes -H "Content-Type: application/json" -d '{
          "title": "Szakszuka z fetą",
          "source": "web",
          "time": 30,
          "servings": 2,
          "difficulty": "Łatwe",
          "dishType": "main",
          "cuisine": "middleeastern",
          "usesAirFryer": false,
          "kcal": 420,
          "protein": 21,
          "fat": 27,
          "carbs": 24,
          "blurb": "Jedno-patelniowe jajka w pomidorach.",
          "tip": "Podawaj z pieczywem.",
          "ingredients": [
            { "name": "Jajka", "quantity": "4", "amountValue": 4, "amountUnit": "szt" },
            { "name": "Pomidory z puszki", "quantity": "1 puszka", "amountValue": 1, "amountUnit": "szt" },
            { "name": "Feta", "quantity": "100 g", "amountValue": 100, "amountUnit": "g" },
            { "name": "Pieczywo", "quantity": "2–4 kromki", "displayText": "2–4 kromki chleba na zakwasie piwnym" },
            { "name": "Marchew", "quantity": "200 g", "amountValue": 200, "amountUnit": "g", "alternativeGroup": "warzywo" },
            { "name": "Cukinia", "quantity": "200 g", "amountValue": 200, "amountUnit": "g", "alternativeGroup": "warzywo" }
          ],
          "steps": [
            "Podsmaż cebulę i czosnek, dodaj pomidory i zredukuj.",
            "Zrób wgłębienia, wbij jajka, przykryj i gotuj do ścięcia białek.",
            "Pokrusz fetę na wierzch."
          ]
        }'
        ```
        Zwraca `201` z `{ "id": "<guid>" }`. Składniki są automatycznie łączone ze
        spiżarnią (dopasowanie odmian po polsku), więc podawaj naturalne polskie nazwy.
        `difficulty`: `Łatwe` / `Średnie` / `Trudne` (domyślnie `Łatwe`).

        `name` to kanoniczna pozycja katalogu spiżarni i jest głównym tekstem w UI.
        `quantity` to sama naturalna ilość pokazywana osobno po prawej, a opcjonalny
        `displayText` zachowuje oryginalny zapis ze źródła jako mniejsze doprecyzowanie
        (np. `name: "Pieczywo"`, `displayText: "2–4 kromki chleba na zakwasie piwnym"`).
        Przy imporcie ze strony, zdjęcia lub książki ustaw `displayText` zawsze, gdy wiersz
        zawiera odmianę, wariant, sposób przygotowania albo inną informację wartą zachowania.
        `amountValue`+`amountUnit` to ilość
        strukturalna (napędza „czy wystarczy w spiżarni" i odejmowanie po ugotowaniu) —
        **zawsze podawaj, gdy ilość jest mierzalna**.

        **Precyzja przepisu jest obowiązkowa.** Nie zapisuj pustej `quantity`, przedziałów
        bez potrzeby ani określeń „do smaku", „szczypta", „odrobina", „garść", „kilka"
        lub „do podania" bez liczby. Jeśli źródło nie podaje ilości, oszacuj jedną
        rozsądną wartość dla bazowej liczby porcji i zapisz ją metrycznie w `quantity`,
        `amountValue` i `amountUnit` (np. `2 g` soli, `0,5 g` pieprzu, `15 ml` oliwy).
        Kroki i `tip` podlegają tej samej zasadzie: każda obróbka ma konkretny czas,
        temperaturę albo poziom ognia. Nie odsyłaj do opakowania i nie kończ instrukcji
        samym „aż zgęstnieje", „do miękkości" lub „do zarumienienia" — dodaj liczbowy
        czas oraz, gdy pomaga, mierzalny punkt końcowy (np. temperatura 74°C w środku).
        Prawdziwe alternatywy nadal zapisuj osobno przez `alternativeGroup`, z dokładną
        ilością dla każdej opcji.

        **Jeden produkt = jeden składnik.** Zbitki typu „Sól, pieprz i zioła” rozbijaj na
        osobne składniki — inaczej ze spiżarnią dopasuje się tylko pierwszy człon (sól),
        a reszta będzie niewidoczna. Przymiotniki zostaw tylko, gdy odróżniają produkt
        („Twaróg chudy” ≠ półtłusty — zostaw; „Dojrzałe awokado” → „Awokado”).

        **Alternatywy zapisuj jako osobne składniki z tym samym `alternativeGroup`.**
        `Marchew` i `Cukinia` z grupą `warzywo` oznaczają „Marchew lub Cukinia”:
        dowolna dostępna opcja spełnia przepis, lista zakupów tworzy jeden wiersz „A lub B”,
        a po ugotowaniu domyślnie odejmowana jest tylko jedna opcja. Nie używaj ukośnika
        wewnątrz `name` i nie stosuj grupy dla produktów potrzebnych jednocześnie.
        API odrzuca połączone nazwy zawierające `/`, `lub` albo `albo`.

        **Tytuł to nazwa dania, nie lista elementów posiłku.** Importując jadłospis nie
        zapisuj tytułu „Jajecznica; pieczywo; warzywa; gruszka" ani „Wrap + Sałatka” —
        tytułem jest danie („Jajecznica z pieczywem i warzywami"), a dodatki posiłku
        (owoc, sok, pieczywo) zostają zwykłymi składnikami.

        **Nazwy składników w mianowniku, tak jak mówi się w kuchni.** Nie kopiuj nazw
        z baz żywieniowych ani dopełniacza z listy („2 łyżki miodu" → nazwa „Miód",
        quantity „2 łyżki"). Przykłady złych → dobrych:
        - „Jaja kurze całe" + `100 g` → `"name": "Jajka", "quantity": "2 szt."`
          (kroki mówią o dwóch jajkach — przelicz, 1 jajko ≈ 50 g);
        - „Mięso z piersi indyka, bez skóry" → „Pierś z indyka";
        - „Mąka pszenna, typ 550" → „Mąka pszenna"; „Czosnku" → „Czosnek".
        Ilość nigdy nie jest częścią nazwy („Łyżeczka pasty gochujang" → nazwa
        „Pasta gochujang", quantity „1 łyżeczka"). `quantity` pisz naturalnie po polsku
        („2 kromki (70 g)", „1 łyżeczka (5 g)"), nie w formacie eksportu
        („2 x Kromka (70.0 g)").

        ### Pozostałe
        - `GET /recipes?q=<szukaj>&source=<ai|web|manual|all>&dishType=<słownik>&cuisine=<słownik>&maxTime=<minuty>&airFryer=<true|false>` — lista.
        - `GET /recipes/{id}` — szczegóły + które składniki są na stanie / do kupienia
          (uwzględnia ilości: za mało w spiżarni = do kupienia). `selectedServings` to
          zapisany wybór porcji z ekranu przepisu — **ilości składników w odpowiedzi są
          już przeskalowane** do tego wyboru (`servings` pozostaje bazową liczbą porcji
          z przepisu; pliki w `context/recipes/` zawsze pokazują ilości bazowe).
        - `PUT /recipes/{id}/servings` — body `{ "servings": 4 }` (1–8): zapisz wybór
          porcji. Skaluje ilości wszędzie, gdzie się liczą (szczegóły, do kupienia,
          cook-proposal, zapotrzebowanie na liście zakupów). Wartość równa bazowej
          liczbie porcji przywraca przepis „jak w oryginale".
        - `GET /recipes/{id}/cook-proposal` — co odjąć ze spiżarni po ugotowaniu
          (na składnik: `pantryItemId`, `proposedAmount`, `deductible`, `skipReason`).
        - `PUT /recipes/{id}` — pełna podmiana (to samo body co POST). **Uwaga:** pominięcie
          `dishType`/`cuisine`/`usesAirFryer`/`kcal`/`protein`/`fat`/`carbs` czyści te pola —
          przy edycji starszego przepisu bez nich uzupełnij je (sklasyfikuj danie, oszacuj
          makro na porcję), zamiast pomijać.
        - `DELETE /recipes/{id}`.
        - `POST /recipes/{id}/add-missing-to-shopping` — dopisz brakujące składniki do zakupów.
          Ponowienie dla tego samego przepisu jest idempotentne; odpowiedź ma
          `{ "added": N, "updated": N }`.

        ### Zdjęcia dania (galeria)
        - `POST /recipes/{id}/image` — multipart (`file`), JPG/PNG/WebP do 5 MB:
          `curl -X POST {API}/recipes/<id>/image -F "file=@zdjecie.jpg"`.
          Nowe zdjęcie **staje się domyślnym** (na karcie i stronie przepisu);
          wcześniejsze zostają w galerii. Przez MCP: narzędzie `add_recipe_image`.
        - `GET /recipes/{id}/images` — galeria (najnowsze najpierw, `isDefault` oznacza główne).
        - `PUT /recipes/{id}/images/{imageId}/default` — ustaw starsze zdjęcie jako główne.
        - `DELETE /recipes/{id}/images/{imageId}` — usuń zdjęcie z galerii; po usunięciu
          głównego domyślnym zostaje najnowsze z pozostałych.

        ## Spiżarnia

        Spiżarnia to zarazem **katalog składników**: pozycja z `quantity: 0` znaczy „znamy,
        nie ma w domu" i zostaje na liście. `/adjust` i `/bulk` **tylko dopasowują** do
        istniejących pozycji (po nazwie i aliasach, z polską odmianą) — nigdy nie tworzą
        nowych; niedopasowane nazwy wracają w `notInCatalog` z podpowiedzią.

        ### POST /pantry/adjust — delty po zakupach (paragon)
        ```bash
        curl -X POST {API}/pantry/adjust -H "Content-Type: application/json" -d '{
          "items": [
            { "name": "Mleko", "quantity": 1000, "unit": "ml" },
            { "name": "Jajka", "quantity": 10 },
            { "name": "Mąka", "quantity": 1, "unit": "kg" }
          ]
        }'
        ```
        `quantity` to delta (ile doszło; ujemna = ubyło, np. coś się zepsuło). `unit` jest
        opcjonalny — sprawdzany z jednostką pozycji; `kg`/`dag`→`g` i `l`→`ml` są przeliczane
        automatycznie. Zwraca `{ "updated": [...], "notInCatalog": [...] }`.

        Pozycje z `notInCatalog`: wariant istniejącego produktu → rozszerz jego `aliases`
        (`PUT /pantry/{id}`) i ponów; nowy staple → `POST /pantry`; jednorazowy → pomiń.

        ### POST /pantry/bulk — ilości absolutne (inwentaryzacja, zdjęcie lodówki)
        ```bash
        curl -X POST {API}/pantry/bulk -H "Content-Type: application/json" -d '{
          "items": [
            { "name": "Jajka", "quantity": 3 },
            { "name": "Oliwa z oliwek", "quantity": 250, "unit": "ml" }
          ]
        }'
        ```
        USTAWIA stan (ile JEST), nie dodaje. Opcjonalnie `category`, `lowThreshold`.
        Zwraca `{ "updated", "results": [...], "notInCatalog": [...] }`.

        ### POST /pantry — nowa pozycja katalogu (świadomie, rzadko)
        `{ "name", "category", "unit", "quantity"?, "lowThreshold"?, "aliases"? }` —
        `unit` (`g`/`ml`/`szt`) jest wymagany. Prosta polska nazwa bazowa, bez marek
        i opakowań („Mleko", nie „Mleko Łaciate 3,2% 1L"); warianty jako `aliases`.
        Duplikat (także rozmyty) → `409` z istniejącą pozycją — wtedy aktualizuj ją,
        zamiast tworzyć nową.

        ### Pozostałe
        - `GET /pantry` — katalog pogrupowany po kategoriach, z ilościami i wyliczonym statusem.
        - `PUT /pantry/{id}` — edycja (nazwa, kategoria, jednostka, ilość, próg, aliasy).
        - `PATCH /pantry/{id}/quantity` — `{ "quantity": 350 }` (absolutnie, ujemne przycinane do 0).
        - `DELETE /pantry/{id}` — usuń z katalogu (zwykle lepiej wyzerować ilość).

        Lista zakupów jest **niezależna** od spiżarni — pozycje `low`/`out` NIE trafiają
        na nią automatycznie; dodaje się je z przepisów, ręcznie albo przez agenta.

        ## Plan tygodnia

        ### PUT /plan/entry — zaplanuj posiłek (upsert po dacie i slocie)
        ```bash
        curl -X PUT {API}/plan/entry -H "Content-Type: application/json" -d '{
          "date": "2026-07-06",
          "slot": "lunch",
          "recipeId": "<guid przepisu>",
          "note": "podwójna porcja, lunch na wtorek"
        }'
        ```
        Zamiast `recipeId` można podać `"title"` (danie bez zapisanego przepisu).
        Ponowny zapis na tę samą datę i slot nadpisuje wpis.

        ### Pozostałe
        - `GET /plan?start=YYYY-MM-DD&days=14` — wpisy (domyślnie od poniedziałku bieżącego
          tygodnia). Każdy wpis ma `cooked` — czy istnieje pasujący wpis w historii
          gotowania (ten sam przepis/nazwa, ±1 dzień).
        - `DELETE /plan/entry/{id}`.
        - `POST /plan/add-missing-to-shopping` — `{ "start": "YYYY-MM-DD", "days": 7 }`;
          sumuje wymagania wszystkich wpisów (także powtórzeń tego samego przepisu),
          odejmuje wspólny stan raz i dopisuje lub aktualizuje scalone zakupy.
        - `GET /plan/pending-cook?days=14` — zaległe wpisy planu: data w przeszłości
          i brak pasującego wpisu w historii gotowania (ten sam przepis lub nazwa,
          ±1 dzień). Użytkownik mógł zapomnieć odnotować posiłek — dopytaj; ugotowany
          → `POST /cooklog` z `cookedAt` = data z planu.
        - `POST /plan/entry/{id}/dismiss-cook-reminder` — posiłek pominięty: nie
          przypominaj o tym wpisie.

        ## Historia gotowania (cook log)

        ### POST /cooklog — odnotuj ugotowane danie
        ```bash
        curl -X POST {API}/cooklog -H "Content-Type: application/json" -d '{
          "recipeId": "<guid przepisu>",
          "rating": 4,
          "note": "następnym razem mniej soli",
          "cookedAt": "2026-07-02",
          "deductions": [
            { "pantryItemId": "<guid pozycji spiżarni>", "amount": 200 },
            { "pantryItemId": "<guid>", "amount": 2, "unit": "szt" }
          ]
        }'
        ```
        Dla dania bez przepisu podaj `"dishName"` zamiast `recipeId`. `rating` 1–5 i
        `cookedAt` (domyślnie dziś) są opcjonalne. `deductions` (opcjonalne) odejmuje
        zużyte składniki ze spiżarni (w jednostce pozycji, przycinane do 0) — policz
        ilości z przepisu; GUID-y znajdziesz w `GET /pantry`. Podpowiedź, co odjąć, daje
        `GET /recipes/{id}/cook-proposal`. Wpisy widać w `cooklog.md` oraz w sekcji
        „Historia" pliku przepisu — korzystaj z nich przy kolejnych propozycjach.

        ### Pozostałe
        - `GET /cooklog?recipeId=<guid>&limit=50` — ostatnie wpisy.
        - `PUT /cooklog/{id}` — popraw wpis: `{ "dishName"?, "rating"?, "note"?, "cookedAt"? }`.
          `rating`/`note` są pełną podmianą (pominięte = wyczyszczone); `dishName`/`cookedAt`
          pominięte zostają bez zmian. Odjęć ze spiżarni nie da się edytować.
        - `DELETE /cooklog/{id}`.

        ## Zakupy

        Lista jest niezależna od spiżarni: nic nie pojawia się ani nie znika na niej
        automatycznie. Nieodhaczone pozycje dodane z przepisów łączą się po kanonicznej
        pozycji spiżarni; wpisy ręczne i odhaczone pozostają osobne. Po paragonie
        odhaczaj/usuwaj kupione pozycje.

        - `GET /shopping` — lista (z `id` do check/delete).
        - `POST /shopping` — `{ "name": "Guanciale", "category": "Fridge", "quantity": 100, "unit": "g", "reason": "Do: Carbonara" }`
          (`quantity`/`unit`/`reason` opcjonalne).
        - `PATCH /shopping/{id}/check` — body `{ "checked": true|false }` ustawia stan
          (idempotentne — używaj tego); puste body przełącza.
        - `POST /shopping/clear-checked` — usuń odhaczone; `DELETE /shopping/{id}` — usuń pozycję.
        - `POST /shopping/clear` — wyczyść całą listę (nieodwracalne).

        ## Profil

        - `GET /preferences` / `PUT /preferences` — podstawowy profil (gospodarstwo, sprzęt, smaki).
        - `GET /profile/questionnaire` — pytania ankiety + obecne odpowiedzi.
        - `PUT /profile/answers` — `{ "answers": { "taste.heat": "4", ... } }`
          (pusta wartość usuwa odpowiedź). Odpowiedzi trafiają do `cookbook.md`.

        ## Kontekst

        - `POST /context/export` — wymuś regenerację plików w tym folderze.
        - `GET /context/cookbook` — aktualny cookbook.md bez zapisu na dysk.
        """.Replace("{API}", apiBase);

    /// <summary>
    /// Slash-command files exported to context/commands/. One markdown format works for
    /// both Claude Code (~/.claude/commands/) and Codex (~/.codex/prompts/); $ARGUMENTS
    /// is replaced by what the user types after the command.
    /// </summary>
    public static IReadOnlyDictionary<string, string> CommandFiles(string apiBase, string contextDir)
    {
        string T(string s) => s.Replace("{API}", apiBase).Replace("{CTX}", contextDir);
        return new Dictionary<string, string>
        {
            ["dodaj-przepis.md"] = T("""
                Dodaj przepis do mojej książki kucharskiej Pichci. Źródło (zdjęcie, plik, link lub opis): $ARGUMENTS

                1. Przeczytaj `{CTX}/AGENTS.md` i schemat w `{CTX}/api.md`.
                2. Obejrzyj / przeczytaj źródło i wyciągnij przepis; znormalizuj go do schematu
                   `POST {API}/recipes` (polskie nazwy składników, kroki jako zdania). Nie używaj
                   „do smaku", „odrobina", „kilka minut" ani instrukcji „według opakowania":
                   ustal dokładne ilości, czasy, temperatury i sprawdzalne punkty końcowe.
                3. Porównaj składniki ze stanem w `{CTX}/pantry.json` i zaproponuj ewentualne zamiany.
                4. Pokaż mi gotową propozycję; po mojej akceptacji zapisz przez API i dopisz
                   brakujące składniki do zakupów (`POST {API}/recipes/{id}/add-missing-to-shopping`).
                5. Jeśli źródło zawiera zdjęcie gotowego dania (plik lub URL), dołącz je:
                   `POST {API}/recipes/{id}/image` (multipart `file`) lub narzędziem MCP `add_recipe_image`.
                """),
            ["paragon.md"] = T("""
                Zaktualizuj spiżarnię Pichci na podstawie: $ARGUMENTS (paragon lub zdjęcie lodówki/szafki).

                1. Przeczytaj `{CTX}/AGENTS.md`.
                2. Wyciągnij produkty spożywcze z ilościami metrycznymi (g / ml / szt) i zmapuj
                   je na pozycje katalogu z `{CTX}/pantry.json` (nazwy i aliasy) — „BUŁKA
                   KAJZERKA" wysyłaj jako „Pieczywo". Pomiń produkty niespożywcze.
                3. Pokaż mi listę do zatwierdzenia, potem:
                   - paragon → `POST {API}/pantry/adjust` z deltami (ile doszło);
                   - zdjęcie lodówki → `POST {API}/pantry/bulk` z ilościami absolutnymi (ile jest).
                4. Pozycje z `notInCatalog`: wariant czegoś z katalogu → dodaj alias
                   (`PUT {API}/pantry/{id}` z rozszerzonym `aliases`) i ponów; nowy stały
                   produkt → `POST {API}/pantry` (z `unit` i `category`); jednorazowy → pomiń
                   i powiedz mi.
                5. Po paragonie sprawdź `GET {API}/shopping` i odhacz/usuń kupione pozycje.
                """),
            ["zaplanuj-tydzien.md"] = T("""
                Zaplanuj posiłki w Pichci. Wytyczne: $ARGUMENTS

                1. Przeczytaj `{CTX}/AGENTS.md`, `{CTX}/cookbook.md`, `{CTX}/pantry.json`,
                   `{CTX}/plan.md` i `{CTX}/cooklog.md` (nie powtarzaj świeżo gotowanych dań).
                2. Zaproponuj plan (domyślnie obiady na nadchodzący tydzień) wykorzystując
                   zapisane przepisy z `{CTX}/recipes/` i to, co jest w spiżarni.
                3. Po mojej akceptacji zapisz wpisy przez `PUT {API}/plan/entry` i wywołaj
                   `POST {API}/plan/add-missing-to-shopping`; podsumuj, co trzeba dokupić.
                """),
        };
    }

    public static string OneShotPrompt(string contextDir, string apiBase) => """
        Mam cyfrową książkę kucharską Pichci. Jej kontekst (profil, spiżarnia, przepisy, plan) leży w:
        {CTX}
        Najpierw przeczytaj {CTX}/AGENTS.md i stosuj się do niego — w szczególności: niczego
        nie zapisuj do plików, zapisy wyłącznie przez REST API pod {API} (aplikacja działa).

        Zadanie:
        """.Replace("{CTX}", contextDir).Replace("{API}", apiBase);

    public static string GlobalSnippet(string contextDir, string apiBase) => """
        ## Pichci — moja książka kucharska

        Gdy rozmowa dotyczy gotowania, przepisów, spiżarni, zakupów spożywczych lub planowania
        posiłków: najpierw przeczytaj `{CTX}/AGENTS.md` i pliki kontekstu, na które wskazuje
        (cookbook.md, pantry.json, plan.md, cooklog.md, recipes/). Wszystkie zapisy — nowe
        przepisy, stan spiżarni, plan tygodnia, historia gotowania — wykonuj przez REST API
        pod `{API}` zgodnie z `{CTX}/api.md`. Nie edytuj plików w tym folderze.
        """.Replace("{CTX}", contextDir).Replace("{API}", apiBase);

    // Connection snippets are rendered in the browser. They intentionally contain
    // paths only: secrets must be configured locally in the agent process and must
    // never be returned by /context/connect.
    public static string ClaudeMcpCommand(string repoDir) =>
        $"claude mcp add pichci -- node \"{repoDir}/mcp/dist/index.js\"";

    public static string CodexMcpToml(string repoDir) => $$"""
        [mcp_servers.pichci]
        command = "node"
        args = ["{{repoDir}}/mcp/dist/index.js"]
        """;

    public static string CommandsInstall(string contextDir) => """
        # Claude Code (komendy /dodaj-przepis, /paragon, /zaplanuj-tydzien)
        cp "{CTX}/commands/"*.md ~/.claude/commands/

        # Codex CLI
        cp "{CTX}/commands/"*.md ~/.codex/prompts/

        # Windows PowerShell:
        #   Copy-Item "{CTX}\commands\*.md" "$HOME\.claude\commands\"
        #   Copy-Item "{CTX}\commands\*.md" "$HOME\.codex\prompts\"
        """.Replace("{CTX}", contextDir);
}
