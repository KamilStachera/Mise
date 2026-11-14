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

    /// <summary>
    /// The one image prompt every agent (Sous, Codex, Claude Code) uses for a missing dish
    /// photo, so generated photos share one look. Only the bracketed parts change per recipe.
    /// Shown in AGENTS.md („Zdjęcie dania, gdy przepis go nie ma”).
    /// </summary>
    public const string RecipePhotoPrompt =
        "Realistic food photography of [exact description of the dish from the recipe: main ingredients, " +
        "colours, texture, how it is served], served on/in [plate / bowl / skillet / baking tray], ingredients " +
        "clearly visible and appetizing. Bright natural window light, clean neutral tabletop, subtle linen " +
        "napkin, realistic textures, 45-degree overhead angle or top-down view, shallow depth of field, " +
        "no people, no hands, no text, no logos, no watermark.";

    public static string AgentsMd(string apiBase) => """
        # Pichci — instrukcje dla asystenta kulinarnego

        Pomagasz planować i gotować posiłki z tej kuchni. Ten folder to Twoja pamięć kulinarna.

        ## Najpierw przeczytaj (w tej kolejności)

        1. `cookbook.md` — gospodarstwo, sprzęt, umiejętności, smaki, profil szczegółowy i zasady.
        2. `pantry.json` — katalog składników z przybliżonym `ilosc` i konserwatywnym
           `iloscDoPlanowania` w jednostce `jednostka` (g / ml / szt). Do decyzji zakupowych
           używaj `iloscDoPlanowania`; `pewnosc` mówi, czy stan jest potwierdzony, szacowany lub stary. Nigdy nie proponuj dania,
           które wymaga czegoś, czego nie ma, bez oznaczenia tego jako „do kupienia".
        3. `plan.md` — co jest zaplanowane na ten i przyszły tydzień.
        4. `cooklog.md` — co ostatnio gotowaliśmy i jak wyszło; traktuj notatki jako feedback.
        5. `recipes/` — zapisane przepisy do wykorzystania lub adaptacji.
        6. `supplies.md` — lista rzeczy do domu (chemia, higiena, papier). Nie ma nic
           wspólnego ze spiżarnią ani z jedzeniem; sekcja „Częste" to rzeczy kupowane
           regularnie, które można dopisywać bez pytania.

        **Dziennika jedzenia, celu, wagi i aktywności nie ma w plikach** — są prywatne
        i osobne dla każdej osoby. Czytasz je i zapisujesz wyłącznie narzędziami / API
        (sekcja „Dziennik jedzenia i odchudzanie” niżej).

        ## Zapisywanie — narzędzia MCP `pichci` albo REST API

        Pliki w tym folderze są **generowane przez aplikację i nadpisywane przy każdej
        zmianie danych — niczego tu nie edytuj ani nie dodawaj**. Jeśli masz narzędzia
        MCP serwera `pichci`, **używaj ich** (klucz i osobę mają już ustawione). Bez nich
        zapisuj przez API pod `{API}` z nagłówkiem `X-Api-Key` (osobisty klucz z aplikacji:
        Profil → Połącz agenta, trzymany w zmiennej `MISE_API_KEY`; szczegóły w `api.md`):

        | co | narzędzie MCP | REST |
        |---|---|---|
        | nowy przepis | `add_recipe` | `POST {API}/recipes` |
        | poprawka kalorii przepisu | `set_recipe_nutrition` | `PATCH {API}/recipes/{id}/nutrition` |
        | zakupy → spiżarnia (delty, paragon) | `add_to_pantry` | `POST {API}/pantry/adjust` |
        | inwentaryzacja (ilości absolutne) | `set_pantry_quantities` | `POST {API}/pantry/bulk` |
        | nowa pozycja katalogu (rzadko) | `create_pantry_item` | `POST {API}/pantry` |
        | plan: posiłek w slocie | `set_plan_entry` | `PUT {API}/plan/entry` |
        | garnek na kilka dni | `plan_cook_for_days` | `POST {API}/diary/cooks` |
        | zjedzone / dopisanie do dziennika | `log_food` | `POST {API}/plan/entries` |
        | ugotowane danie (+ odjęcie ze spiżarni) | `log_cook` | `POST {API}/cooklog` |
        | lista zakupów | `add_shopping_items` | `POST {API}/shopping` |
        | lista domowa (chemia, papier) | `add_supplies` | `POST {API}/supplies` |
        | ćwiczenie: polski opis + film | `enrich_exercises` | `POST {API}/exercises/enrich` |
        | nowe ćwiczenie (pilates, joga…) | `add_exercise` | `POST {API}/exercises` |
        | ankieta treningowa | `set_training_profile` | `PUT {API}/training/profile` |
        | nowy plan treningowy | `create_training_program` | `POST {API}/training/programs` |
        | zamiana ćwiczenia w planie | `update_program_exercise` | `PATCH {API}/training/program-exercises/{id}` |

        Pełna dokumentacja endpointów i schematów JSON: **`api.md`**. Po udanym zapisie
        aplikacja sama odświeża pliki w tym folderze.

        ## Typowe zadania

        ### Przepis ze zdjęcia (lub tekstu / strony / PDF-a)
        1. Obejrzyj zdjęcie / przeczytaj źródło samodzielnie i wyciągnij przepis. Link do
           strony lub PDF-a: `POST {API}/import/url` (MCP `read_recipe_page`) — zwraca przepisy
           z danych strukturalnych strony albo jej tekst; PDF czytasz stronami przez
           `GET {API}/import/documents/{id}` (MCP `read_import_document`).
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

        ### Zdjęcie dania, gdy przepis go nie ma
        Przepisy bez zdjęcia: `GET {API}/recipes?hasImage=false` (MCP `search_recipes` z
        `hasImage: false`). Gdy jest prawdziwe zdjęcie (moje albo ze źródła przepisu) — użyj
        jego, nie generuj. Wygenerowane zdjęcie ma pokazywać ten konkretny przepis (opis bierz
        z jego składników i kroków), a nie ogólne stockowe jedzenie, i wszystkie mają mieć
        jeden, spójny styl:
        - realistyczna fotografia jedzenia, nie ilustracja; danie od razu rozpoznawalne;
        - jasne, naturalne światło, najlepiej od okna;
        - estetyczny talerz, miska, patelnia albo blacha — to, w czym danie się podaje;
        - widok pod kątem 45° albo lekko z góry;
        - czyste, neutralne tło: jasny blat, lniana serwetka, subtelne dodatki;
        - bez ludzi, dłoni i sztućców zasłaniających danie; bez napisów, etykiet, logo
          i znaków wodnych;
        - plik JPG/PNG/WebP poniżej 5 MB.

        Prompt dla każdego zdjęcia — uzupełnij tylko nawiasy kwadratowe, resztę zostaw bez zmian:

        ```
        {PHOTO_PROMPT}
        ```

        Plik dołącz przez `POST {API}/recipes/{id}/image` (multipart `file`) albo MCP
        `add_recipe_image` (`filePath`), potem sprawdź, że przepis ma `imageUrl`. Wiele zdjęć
        naraz (partie, kontaktówka do przeglądu): komenda `/zdjecia-przepisow`.

        ### Paragon → spiżarnia + lista zakupów
        1. Wyciągnij surowe nazwy produktów spożywczych z ilościami w jednostkach metrycznych
           (g / ml / szt). Pomiń chemię
           i inne produkty niespożywcze.
        2. Jedno `POST {API}/pantry/adjust` z opcjonalnym `merchant` i deltami (ile DOSZŁO).
           Wysyłaj nazwę z paragonu. Gdy rozstrzygasz nieznaną pozycję, dodaj jej kanoniczny
           `pantryItemId`; aplikacja zapamięta to mapowanie dla kolejnych paragonów z tego sklepu.
           Pozycje z `notInCatalog`
           NIE zostały zapisane — zdecyduj per pozycja:
           - wariant czegoś z katalogu → ponów adjust z `pantryItemId` kandydata;
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
        2. Zapisuj `set_plan_entry` / `PUT {API}/plan/entry` dzień po dniu (sloty:
           `breakfast` / `lunch` / `dinner`). To samo danie na kilka dni = jeden garnek:
           `plan_cook_for_days` / `POST {API}/diary/cooks` (dzień gotowania + resztki).
        3. Najpierw `preview_plan_shopping`, potem `add_plan_missing_to_shopping`.
           Jeśli użytkownik poda korekty, prześlij je jako `confirmations`; bez nich system użyje
           bezpiecznej ilości konserwatywnej. Podsumuj, co trzeba dokupić.

        ## Dziennik jedzenia i odchudzanie

        Kalendarz jest jednocześnie planem i dziennikiem: każdy wpis jest albo zaplanowany,
        albo zjedzony (`eaten`). Każda osoba w domu ma własny dziennik, cel, wagę i opaskę —
        narzędzia działają na osobie, w imieniu której rozmawiasz. Zakupy, spiżarnia
        i przepisy są wspólne.

        - **Co zjedzone** („zjadłem batonika”, „na obiad była zupa”): `log_food` (domyślnie
          `eaten: true`). Zapisany przepis → `recipeId` + `portions`; wszystko inne →
          `title` + `kcal` i makro jako **sumy** dla zjedzonej ilości (przelicz ze 100 g sam).
          Najpierw sprawdź `get_food_favorites` — tam są produkty tej osoby z dokładnymi
          wartościami (`log_food_favorite`).
          Przekąski i słodycze idą do slotu `snack`; w jednym slocie może być wiele wpisów.
        - **Zaplanowane, a potem zjedzone**: `update_plan_entry` z `eaten: true` (id z
          `get_plan`). Zjedzenie przepisu zapisuje jego kcal na stałe — nie przeliczaj
          historii, gdy przepis się zmieni.
        - **Resztki z garnka**: `get_fridge` → `eat_from_fridge`. Nie dopisuj ich jako nowego
          przepisu (zakupy liczą tylko dzień gotowania).
        - **Ile zostało na dziś**: `get_budget` (budżet = cel + część kcal z aktywności)
          minus suma kcal zjedzonych wpisów dnia z `get_plan`. Postępy, trend wagi i bilans
          tygodnia: `get_progress`; cel i jego wyliczenie: `get_goal`.
        - **Catering** (dieta pudełkowa): w dni dostawy aplikacja sama dopisuje wpis
          „Catering” jako zjedzony — nie dopisuj go drugi raz. Usunięcie wpisu = „dziś bez
          cateringu”.
        - **Waga**: `log_weight`. **Trening**, którego nie złapała opaska: `log_workout`
          (najpierw `get_activity`, żeby nie liczyć go dwa razy).
        - Dni są polskie (strefa Europe/Warsaw). „Wczoraj”, „dziś” licz od dzisiejszej daty.
        - Usuwanie wpisów i zmiany celu tylko na wyraźną prośbę. Bądź wspierający, bez
          moralizowania: dzień ponad budżet to informacja, nie porażka.

        ## Trening — katalog ćwiczeń

        Aplikacja ma wspólny katalog ok. 820 ćwiczeń (zaimportowany z free-exercise-db, po
        angielsku). Każde ma partie mięśni (główne / pomocnicze), sprzęt i poziom; ekran
        ćwiczenia pokazuje mapę mięśni, film, kroki, „Na co uważać” i „Częste błędy”. Katalogu
        nie ma w plikach — szukaj `search_exercises`, czytaj `get_exercise`.

        - **Aplikacja sama uzupełnia opisy i filmy w tle** (GPT z wyszukiwarką, kilka ćwiczeń
          na minutę; najpierw te z aktywnych planów). Nie musisz tego robić przy okazji innych
          zadań — `enrich_exercises` służy do poprawek albo przyspieszenia.
        - **Polskie opisy** dopisujesz `enrich_exercises` (komenda `/wzbogac-cwiczenia`):
          `namePl`, `instructionsPl` (3–6 kroków), `tipsPl` (2–4 wskazówki techniczne),
          `mistakesPl` (2–4 błędy). Pisz prostym językiem, jak trenerka do początkującej osoby.
        - **Film** (`youtubeId`): wyłącznie film, który znalazłeś w wyszukiwarce i który
          pokazuje dokładnie to ćwiczenie; krótkie polskie filmy mają pierwszeństwo, potem
          angielskie. **Nigdy nie zgaduj id** — serwer sprawdza każdy film w YouTube i odrzuca
          nieistniejące lub zablokowane do osadzania. Bez dostępu do wyszukiwarki pomiń film.
        - Ćwiczenia spoza katalogu (pilates, joga, mobilność) dodawaj `add_exercise` — najpierw
          sprawdź, czy nie ma ich już pod angielską nazwą.

        ## Trening — ankieta i plan (prywatne, per osoba)

        Każda osoba ma ankietę treningową (`get_training_profile`) i co najwyżej jeden aktywny
        plan (`get_training_program`); „co dziś” → `get_training_today`. Komenda
        `/plan-treningowy` prowadzi przez układanie planu.

        - **Plan rozpisujesz w całości**: każdy tydzień i każdy dzień (`week` 1…n, `weekday`
          0 = poniedziałek). Ta sama `name` w kolejnych tygodniach = ten sam trening z progresją
          (np. +1 seria, wyższy zakres powtórzeń, dłuższy plank). Liczba dni i ich długość —
          z ankiety (`daysPerWeek`, `minutesPerSession`, `preferredWeekdays`); 4–8 ćwiczeń na
          dzień, zaczynaj od złożonych.
        - **Tylko ćwiczenia z katalogu**, dobrane do miejsca: dom = `homeEquipment` + masa ciała
          (`search_exercises` z `location: home`), siłownia = wszystko. Szanuj `limitations`
          (kontuzje) i `dislikes`. Zakresy powtórzeń (`repsMin`–`repsMax`), ćwiczenia na czas
          przez `seconds`. `targetKg` tylko gdy masz podstawę — lepiej pominąć niż zgadywać.
        - Polskie opisy i filmy ćwiczeń z nowego planu aplikacja dopisze w tle w ciągu kilku
          minut — nie musisz ich pisać przed zapisaniem planu.
        - **Dzień z filmem** (`kind: "follow-along"`): jeden pełny trening z YouTube (pilates,
          joga, HIIT) z `videoYoutubeId` znalezionym w wyszukiwarce (sprawdzany — nie zgaduj),
          `videoMinutes` i `workoutType`. Tylko gdy styl jest w `styles`.
        - W `rationale` krótko wyjaśnij jej plan: podział, progresję, co z ankiety uwzględniłeś.
        - Najpierw pokaż propozycję (tydzień 1 + jak rośnie), zapisuj po akceptacji
          (`create_training_program` z `activate: true`). Zmiany jednego ćwiczenia:
          `update_program_exercise` (zamiana: `get_exercise_alternatives`); większe zmiany:
          `replace_training_program`.

        ## Zasady

        Preferencje sprzętowe, ostrość, budżet itd. — patrz `cookbook.md`, sekcje „Zasady dla
        asystenta" i „Profil szczegółowy (ankieta)". Kalorie i makro przepisu są zawsze **na
        jedną porcję = jedna osoba**; „domyślna liczba porcji” z profilu dotyczy gotowania dla
        całego domu. Przy każdej propozycji wskaż wszystko, co trzeba dokupić.
        """.Replace("{API}", apiBase).Replace("{PHOTO_PROMPT}", RecipePhotoPrompt);

    public static string ApiMd(string apiBase) => """
        # Pichci — REST API dla agentów

        Baza: `{API}`. Aplikacja musi działać (`docker compose up`). JSON w UTF-8,
        daty w formacie `YYYY-MM-DD`, identyfikatory to GUID-y.
        Każdy udany zapis automatycznie regeneruje pliki w folderze `context/`.

        ## Uwierzytelnianie

        Odczyty (GET) są otwarte, z wyjątkiem prywatnych: `/diary/*`, `/body/*`,
        `/activity/*`, `/training/*`, `/chat/*`, `/context/status`, `/context/connect` i `/swagger`.
        `GET /plan` bez klucza pokazuje sam plan posiłków (bez przekąsek, wpisów z kcal
        i stanu „zjedzone”) — o ile serwer udostępnia publiczny dom. **Każdy zapis
        (POST/PUT/PATCH/DELETE) i każdy prywatny odczyt wymaga nagłówka `X-Api-Key`** z
        osobistym kluczem (`pk_…`), który domownik generuje w aplikacji (Profil → Połącz
        agenta) i trzyma w zmiennej `MISE_API_KEY` po stronie agenta. Klucz działa jako ta
        osoba, w jej domu — inne domy są dla niego niewidoczne:

        ```bash
        curl -X POST {API}/shopping -H "X-Api-Key: $MISE_API_KEY" \
          -H "Content-Type: application/json" -d '{ "name": "Masło" }'
        ```

        Dodawaj ten nagłówek do wszystkich przykładów zapisu poniżej. Brak lub zły
        klucz → `401`. (Ludzie w przeglądarce logują się kontem Google — agentów to
        nie dotyczy; serwer MCP czyta klucz ze zmiennej środowiskowej `MISE_API_KEY`.
        Unieważniony w aplikacji klucz przestaje działać od razu.)

        ## Słowniki

        | pole | wartości |
        |---|---|
        | `source` (przepis) | `ai` — Twoja kreacja · `web` — książka/strona · `manual` — własne |
        | `dishType` (przepis) | `breakfast` — śniadanie · `main` — danie główne · `soup` — zupa · `salad` — sałatka · `side` — dodatek · `dessert` — deser · `snack` — przekąska · `baking` — wypieki |
        | `cuisine` (przepis) | `polish` · `italian` · `french` · `spanish` · `greek` · `mediterranean` · `middleeastern` · `indian` · `thai` · `vietnamese` · `chinese` · `japanese` · `korean` · `mexican` · `american` · `other` |
        | `category` (spiżarnia) | `produce` — warzywa i owoce · `fridge` — lodówka · `pantry` — spiżarnia · `spices` — przyprawy |
        | `unit` (spiżarnia/składniki) | `g` — gramy · `ml` — mililitry · `szt` — sztuki |
        | `slot` (plan) | `breakfast` · `lunch` · `dinner` · `snack` (przekąski — dziennik, prywatne) |

        Status spiżarni (`in` — jest · `low` — mało · `out` — brak) jest **wyliczany z ilości**
        (0 → `out`, poniżej progu → `low`) — nie da się go ustawić wprost; ustawia się ilości.

        `dishType` i `cuisine` są opcjonalne, ale **zawsze je ustawiaj przy dodawaniu przepisu**
        — napędzają filtry w bibliotece. Nieznana wartość → `400` z listą dozwolonych.

        `usesAirFryer` (bool) — **zawsze ustawiaj przy dodawaniu przepisu**: `true`, gdy danie
        przygotowuje się we frytkownicy beztłuszczowej (ulubiony sprzęt użytkownika), inaczej
        `false`. Pominięte/`null` = aplikacja zgaduje z tekstu przepisu (mniej przewidywalne).

        `sourceName` (tekst, maks. 80 znaków, opcjonalny) — skąd pochodzi przepis: książka,
        strona, jadłospis (np. „Daily Dieta”). Aplikacja pokazuje go nad tytułem na kartach.
        **Nie doklejaj go do tytułu** („Daily Dieta - Sernik” ✗ → `title`: „Sernik”,
        `sourceName`: „Daily Dieta” ✓). Gdy źródła nie ma, pomiń pole. Biblioteka filtruje po
        źródle, więc **użyj dokładnie tej pisowni, która już istnieje** (lista „Źródła” w
        `cookbook.md`), zamiast tworzyć wariant („Blond Kuchara”, nie „Blond kucharz”).

        `kcal` (int), `protein`, `fat`, `carbs` (liczby, gramy) — szacunkowe wartości odżywcze
        **NA JEDNĄ PORCJĘ = to, co zjada jedna osoba**, nie na całe danie: suma ze wszystkich
        składników podzielona przez `servings`. **Zawsze oszacuj je przy dodawaniu przepisu**
        (wystarczy rozsądne przybliżenie). Aplikacja domyślnie pokazuje przepis na 1 porcję
        i mnoży kcal/makro przez wybraną liczbę porcji, więc wartość na całe danie albo
        niezgodna z `servings` daje błędne kalorie w planie i dzienniku. Napędzają
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
          "sourceName": "Jadłonomia",
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
        - `GET /recipes?q=<szukaj>&source=<ai|web|manual|all>&sourceName=<źródło>&dishType=<słownik>&cuisine=<słownik>&maxTime=<minuty>&airFryer=<true|false>&hasImage=<true|false>` — lista.
          `q` szuka w tytule i źródle; `sourceName` to dokładne źródło (bez względu na wielkość liter);
          `hasImage=false` — tylko przepisy bez zdjęcia dania.
        - `GET /recipes/{id}` — szczegóły + które składniki są na stanie / do kupienia
          (uwzględnia ilości: za mało w spiżarni = do kupienia). `selectedServings` to
          zapisany wybór porcji z ekranu przepisu (**domyślnie 1** — jedna osoba) — **ilości
          składników w odpowiedzi są już przeskalowane** do tego wyboru (`servings` pozostaje
          bazową liczbą porcji z przepisu; pliki w `context/recipes/` zawsze pokazują ilości
          bazowe). `kcal`/makro zawsze na jedną porcję — razem to `kcal × selectedServings`.
          `?base=true` zwraca ilości jak w przepisie (bez skalowania) — **użyj go zawsze
          przed `PUT`**, inaczej zapiszesz przeskalowane ilości jako bazowe.
        - `PUT /recipes/{id}/servings` — body `{ "servings": 4 }` (1–8, albo do bazowej liczby porcji, gdy większa): zapisz wybór
          porcji. Skaluje ilości wszędzie, gdzie się liczą (szczegóły, do kupienia,
          cook-proposal, zapotrzebowanie na liście zakupów). `1` przywraca domyślną
          jedną porcję. Plan tygodnia tego nie używa: wpis kupuje swoje `portions`,
          a gotowanie na kilka dni — cały garnek.
        - `GET /recipes/{id}/cook-proposal` — co odjąć ze spiżarni po ugotowaniu
          (na składnik: `pantryItemId`, `proposedAmount`, `deductible`, `skipReason`).
        - `PUT /recipes/{id}` — pełna podmiana (to samo body co POST). **Uwaga:** pominięcie
          `dishType`/`cuisine`/`usesAirFryer`/`sourceName`/`kcal`/`protein`/`fat`/`carbs` czyści te pola —
          przy edycji starszego przepisu bez nich uzupełnij je (sklasyfikuj danie, oszacuj
          makro na porcję), zamiast pomijać. Treść ingrediencji bierz z
          `GET /recipes/{id}?base=true`.
        - `PATCH /recipes/{id}/nutrition` — body `{ "kcal": 450, "protein": 30, "fat": 15,
          "carbs": 40, "servings": 2 }`: zmienia **tylko** wartości odżywcze (na jedną porcję,
          komplet czterech) i opcjonalnie `servings` (na ile porcji wychodzą ilości z przepisu).
          Składniki, kroki i reszta pól zostają. Bezpieczna droga do poprawiania kalorii —
          zamiast pełnego `PUT`.
        - `DELETE /recipes/{id}`.
        - `POST /recipes/{id}/add-missing-to-shopping` — dopisz brakujące składniki do zakupów.
          Ponowienie dla tego samego przepisu jest idempotentne; odpowiedź ma
          `{ "added": N, "updated": N }`.

        ### Zdjęcia dania (galeria)
        - `GET /images/{fileName}/card-v1.webp` — miniatura WebP (maks. 640 px na dłuższym
          boku), tworzona i zapisywana przy pierwszym odczycie, także dla starych zdjęć.
          Obsługuje ETag / odczyt warunkowy; nieprawidłowe lub zbyt duże obrazy zwracają
          oryginał. `imageUrl` oraz adresy galerii nadal wskazują oryginały.
        - `POST /recipes/{id}/image` — multipart (`file`), JPG/PNG/WebP do 5 MB:
          `curl -X POST {API}/recipes/<id>/image -F "file=@zdjecie.jpg"`.
          Nowe zdjęcie **staje się domyślnym** (na karcie i stronie przepisu);
          wcześniejsze zostają w galerii. Przez MCP: narzędzie `add_recipe_image`.
          Pliki powyżej 1 MB serwer zapisuje jako WebP (maks. 2048 px na dłuższym boku),
          więc `imageUrl` może mieć inne rozszerzenie niż przesłany plik.
        - `GET /recipes/{id}/images` — galeria (najnowsze najpierw, `isDefault` oznacza główne).
        - `PUT /recipes/{id}/images/{imageId}/default` — ustaw starsze zdjęcie jako główne.
        - `DELETE /recipes/{id}/images/{imageId}` — usuń zdjęcie z galerii; po usunięciu
          głównego domyślnym zostaje najnowsze z pozostałych.

        ### Import ze strony lub PDF-a (tylko odczyt)
        Pomocniki do czytania źródeł — niczego nie zapisują. Przepis znormalizuj jak każdy inny
        i zapisz `POST /recipes` (po mojej zgodzie). Prywatne: wymagają klucza / sesji.
        - `POST /import/url` `{ "url": "https://…" }` — serwer pobiera adres (tylko publiczne
          http/https, maks. 20 MB). Odpowiedź: `kind` `"page"` → `recipes[]` z danych
          schema.org strony (`name`, `yield`, `prepMinutes`/`cookMinutes`/`totalMinutes`,
          `ingredients[]` i `steps[]` jak na stronie, `imageUrl`, `nutrition` na porcję jako
          tekst); gdy `recipes` jest puste — `text` strony (`textTruncated` przy ucięciu).
          `kind` `"pdf"` → PDF zapisany jako dokument, `document` = pierwsze strony.
          Błąd pobrania → 422 `{ "error": "…" }` (po polsku, do przekazania).
          MCP: `read_recipe_page`.
        - `POST /import/documents` — multipart (`file`), PDF do 20 MB → `{ id, name, pageCount,
          textChars, looksScanned }`. Tak trafia do Sous załącznik z czatu.
        - `GET /import/documents/{id}?fromPage=1&toPage=` — tekst stron (`pages[]` z `page` i
          `text`), maks. ok. 40 tys. znaków naraz; czytaj dalej od `nextPage`, aż będzie `null`.
          `looksScanned: true` = skan bez warstwy tekstu (poproś o zdjęcia stron). Dokumenty
          znikają po 14 dniach. MCP: `read_import_document`.

        ## Spiżarnia

        Spiżarnia to zarazem **katalog składników**: pozycja z `quantity: 0` znaczy „znamy,
        nie ma w domu" i zostaje na liście. `/adjust` i `/bulk` **tylko dopasowują** do
        istniejących pozycji (po nazwie i aliasach, z polską odmianą) — nigdy nie tworzą
        nowych; niedopasowane nazwy wracają w `notInCatalog` z podpowiedzią.

        `quantity` jest najlepszym szacunkiem stanu. `planningQuantity` to konserwatywna
        ilość używana przy wyliczaniu zakupów, a `confidence` ma wartość `confirmed`,
        `estimated` lub `stale`. Ręczne ustawienie i `/bulk` potwierdzają stan; paragon
        dodaje pewny zakup, a gotowanie pozostawia margines na niedokładne zużycie.

        ### POST /pantry/adjust — delty po zakupach (paragon)
        ```bash
        curl -X POST {API}/pantry/adjust -H "Content-Type: application/json" -d '{
          "merchant": "Lidl",
          "items": [
            { "name": "MLEKO UHT 2%", "quantity": 1000, "unit": "ml", "pantryItemId": "<id Mleka>" },
            { "name": "JAJA M 10", "quantity": 10, "pantryItemId": "<id Jajek>" },
            { "name": "Mąka", "quantity": 1, "unit": "kg" }
          ]
        }'
        ```
        `quantity` to delta (ile doszło; ujemna = ubyło, np. coś się zepsuło). `unit` jest
        opcjonalny — sprawdzany z jednostką pozycji; `kg`/`dag`→`g` i `l`→`ml` są przeliczane
        automatycznie. Jawny `pantryItemId` zapisuje mapowanie surowej nazwy, opcjonalnie
        w zakresie `merchant`. Zwraca `{ "updated", "notInCatalog", "matches" }`.

        Pozycje z `notInCatalog`: wybierz bezpiecznego kandydata i ponów z `pantryItemId`;
        nowy staple → `POST /pantry`; jednorazowy → pomiń. Mapowania paragonowe nie są
        aliasami przepisu. `GET /pantry/receipt-mappings` je pokazuje, a
        `DELETE /pantry/receipt-mappings/{id}` usuwa błędne mapowanie.

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
        - `GET /pantry` — katalog z szacunkiem, `planningQuantity`, `confidence` i statusem.
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
        Ponowny zapis na tę samą datę i slot nadpisuje pierwszy zaplanowany posiłek w tym
        slocie; zjedzone wpisy, resztki i gotowanie na kilka dni zostają nietknięte.
        Slot może mieścić kilka wpisów (np. resztki obok świeżego dania).

        ### Gotowanie na kilka dni (garnek)
        `POST /diary/cooks` — `{ "recipeId": "<guid>", "portions": 4, "firstDate": "2026-07-06",
        "firstSlot": "dinner", "assignments": [{ "date": "2026-07-07", "slot": "lunch" }] }`.
        Pierwszy dzień to dzień gotowania; każde przypisanie to jedna porcja resztek
        (`isLeftover: true`). Zakupy liczą tylko dzień gotowania, przeskalowany do całego
        garnka — resztek nie kupuje się drugi raz. Planując to samo danie na kilka dni,
        używaj tego zamiast kilku osobnych `PUT /plan/entry`.

        ### Pozostałe
        - `GET /plan?start=YYYY-MM-DD&days=14` — wpisy (domyślnie od poniedziałku bieżącego
          tygodnia). Każdy wpis ma `cooked` — czy istnieje pasujący wpis w historii
          gotowania (ten sam przepis/nazwa, ±1 dzień) — oraz `eaten`, `portions`,
          `kcal`/`protein`/`fat`/`carbs` (sumy dla wpisu, `kcalMissing` gdy brak szacunku),
          `cookId`/`isLeftover` dla garnków i `isCatering`. Z kluczem API zwraca też dziennik
          (przekąski, wpisy z kcal); bez klucza — sam plan posiłków.
        - `DELETE /plan/entry/{id}` — usunięcie dnia gotowania usuwa też zaplanowane resztki
          (zjedzone zostają w dzienniku).
        - `GET /plan/shopping-preview?start=YYYY-MM-DD&days=7` — porównuje szacunek z
          ilością konserwatywną i oznacza `needsConfirmation` tylko gdy zmienia wynik zakupów.
        - `POST /plan/add-missing-to-shopping` — `{ "start": "YYYY-MM-DD", "days": 7,
          "confirmations": [{ "pantryItemId": "<guid>", "quantity": 350 }] }`;
          sumuje wymagania wszystkich wpisów (także powtórzeń tego samego przepisu),
          atomowo potwierdza podane stany, odejmuje wspólny konserwatywny stan raz i dopisuje
          lub aktualizuje scalone zakupy. `confirmations` jest opcjonalne.
        - `GET /plan/pending-cook?days=14` — zaległe wpisy planu: data w przeszłości
          i brak pasującego wpisu w historii gotowania (ten sam przepis lub nazwa,
          ±1 dzień). Użytkownik mógł zapomnieć odnotować posiłek — dopytaj; ugotowany
          → `POST /cooklog` z `cookedAt` = data z planu.
        - `POST /plan/entry/{id}/dismiss-cook-reminder` — posiłek pominięty: nie
          przypominaj o tym wpisie.

        ## Dziennik jedzenia (prywatny, per osoba)

        Kalendarz to jednocześnie plan i dziennik: wpis jest zaplanowany albo zjedzony
        (`eaten`). Dziennik, cel, waga, aktywność i catering są osobne dla każdej osoby.
        Domyślnie działasz na osobie, do której należy klucz; nagłówek `X-Person: <id>` wybiera
        inną osobę z tego samego domu (lista: `GET /auth/me` → `people`; osoby z innych domów
        są ignorowane). Zakupy, spiżarnia, przepisy i pending-cook są wspólne dla domu.
        Nic z tej sekcji nie trafia do plików w `context/`.

        ### POST /plan/entries — dopisz wpis (zawsze nowy, nigdy nie nadpisuje)
        ```bash
        curl -X POST {API}/plan/entries -H "Content-Type: application/json" -d '{
          "date": "2026-07-06", "slot": "snack", "title": "Kinder Bueno", "grams": 43,
          "kcal": 245, "protein": 3.7, "fat": 16, "carbs": 21, "eaten": true
        }'
        ```
        Zapisany przepis: `recipeId` + `portions` (0,25–10, domyślnie 1) — kcal liczy
        aplikacja (kcal przepisu na porcję × porcje). Bez przepisu: `title` + `kcal`, `protein`,
        `fat`, `carbs` jako **sumy dla całego wpisu** (`grams` jest informacyjne — przelicz
        wartości ze 100 g sam). `eaten` domyślnie `false` (= zaplanowane); zapisując coś
        zjedzonego, wyślij `true`. Opcjonalne `"favorite": { "name", "kcal", "protein"?,
        "fat"?, "carbs"?, "per100g"?, "lastGrams"?, "barcode"? }` zapamiętuje produkt w
        „Ulubionych”.

        ### PATCH /plan/entry/{id} — zmień wpis (tylko podane pola)
        `{ "eaten"?, "date"?, "slot"?, "note"?, "portions"? (wpisy z przepisem), "title"?,
        "kcal"?, "protein"?, "fat"?, "carbs"?, "grams"? (wpisy bez przepisu) }`. Przejście na
        `eaten: true` zapisuje kcal/makro przepisu na stałe (snapshot) — historia nie zmienia
        się, gdy potem poprawisz przepis. `grams: 0` czyści gramy.

        ### Garnki i lodówka
        - `GET /diary/fridge` — „W lodówce”: garnki z ostatnich 7 dni z porcjami
          (`cookId`, `remaining`, `kcalPerPortion`).
        - `POST /diary/cooks/{id}/eat` — `{ "date", "slot" }`: zjedz porcję (wpis resztek, zjedzony).
        - `POST /diary/cooks/{id}/discard` — reszta wyrzucona; niezaplanowane porcje znikają.
        - `GET /diary/cooks/{id}` — garnek z wpisami; `PUT /diary/cooks/{id}` —
          `{ "portions", "assignments": [{ "date", "slot" }] }` podmienia zaplanowane resztki
          (zjedzone zostają) i wielkość garnka.
        - `POST /diary/cooks` może też zamienić istniejący wpis w dzień gotowania:
          dodaj `"fromEntryId": "<guid wpisu>"`.

        ### Ulubione produkty
        - `GET /diary/favorites` — ranking (`?all=true` — wszystkie, z ukrytymi). Wartości na
          porcję albo na 100 g (`per100g`, `lastGrams` = zwykła ilość).
        - `POST /diary/favorites` — zapamiętaj produkt (body jak `favorite` wyżej).
        - `POST /diary/favorites/{id}/log` — `{ "date", "slot", "grams"? }`: zapisz jako zjedzony.
        - `PATCH /diary/favorites/{id}` — `{ "pinned"?, "hidden"? }`.
        - `GET /diary/barcode/{kod}` — produkt po kodzie kreskowym (najpierw zapamiętany,
          potem Open Food Facts; wartości na 100 g).

        ## Cel, waga i aktywność (prywatne, per osoba)

        - `GET /body` — cel: `sex` (`female`/`male`), `birthYear`, `heightCm`, `goalKg`,
          `activityLevel` (`sedentary`/`light`/`moderate`/`high`), `paceKg` (kg/tydzień, 0–1),
          `targetOverride`, `proteinOverride`, `addBackPercent` (jaka część kcal z aktywności
          wraca do budżetu) oraz wyliczone `bmr`, `tdee`, `computedTarget`, `target`,
          `proteinTarget`. `configured: false` = jeszcze nieustawiony.
        - `PUT /body` — pełna podmiana tych pól (+ opcjonalnie `currentKg` = dzisiejsze ważenie).
        - `GET /body/budget?start=YYYY-MM-DD&days=7` — na dzień: `target`, `activeKcal`,
          `bonus`, `budget` (= target + bonus); ile zostało = `budget` − suma kcal zjedzonych
          wpisów dnia. `target: null` = brak celu.
        - `GET /body/progress?days=84` — waga (`weights` z trendem 7-dniowym), `weeklyChange`,
          `etaWeeks`, `week` (średnio zjedzone vs budżet, deficyt, szacowany spadek) i `streak`.
        - `PUT /body/weights/{YYYY-MM-DD}` — `{ "kg": 72.4 }` (25–350); ręczny wpis wygrywa
          z wagą łazienkową. `DELETE /body/weights/{data}` usuwa.
        - Catering (dieta pudełkowa): `GET/PUT /body/catering` — `{ "enabled": true,
          "kcal": 1996, "protein": 145, "fat": 77, "carbs": 180, "weekdays": 31,
          "startDate": "YYYY-MM-DD" }` (`weekdays`: bit 0 = poniedziałek … bit 6 = niedziela).
          W dni dostawy wpis „Catering” (`isCatering: true`) dopisuje się sam jako zjedzony;
          usunięty nie wraca. `POST /body/catering/log` — `{ "date" }` dopisuje pudełko
          w dzień bez dostawy.
        - `GET /activity?days=7` — kcal aktywne na dzień (opaska + ręczne treningi), `bonus`,
          treningi, `state` (`none`/`connected`/`stale`).
        - `POST /activity/workouts` — `{ "date", "type", "minutes", "kcal", "time"? ("HH:mm") }`
          ręczny trening; `DELETE /activity/workouts/{id}`. Treningów z opaski nie dopisuj.

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

        - `GET /shopping` — lista (z `id` do check/delete); `recipes` przy pozycji to przepisy
          (`id`, `title`, `imageUrl`), dla których trafiła na listę — z przepisu lub planu.
        - `POST /shopping` — `{ "name": "Guanciale", "category": "Fridge", "quantity": 100, "unit": "g", "reason": "Do: Carbonara" }`
          (`quantity`/`unit`/`reason` opcjonalne).
        - `PATCH /shopping/{id}/check` — body `{ "checked": true|false }` ustawia stan
          (idempotentne — używaj tego); puste body przełącza.
        - `POST /shopping/clear-checked` — usuń odhaczone; `DELETE /shopping/{id}` — usuń pozycję.
        - `POST /shopping/clear` — wyczyść całą listę (nieodwracalne).

        ## Dom i chemia

        Osobna lista na rzeczy nieżywnościowe (papier toaletowy, płyn do naczyń, worki na
        śmieci). Jest niezależna od spiżarni **i od listy zakupów spożywczych** — nic się
        między nimi nie synchronizuje. Pozycje mają samą nazwę: bez ilości i bez jednostek.

        Aplikacja liczy, jak często coś tu ląduje, i zwraca ranking `hot` — to gotowy
        słownik do szybkiego dopisywania (np. „dopisz zwykłe rzeczy do domu").

        - `GET /supplies` — `{ "items": [...], "total", "checkedCount", "hot": [...] }`.
          `hot` pomija to, co już jest na liście.
        - `POST /supplies` — `{ "name": "Papier toaletowy" }`. `category` opcjonalne
          (`cleaning` | `hygiene` | `paper` | `kitchen` | `pets` | `other`); pominięte
          zostaje zgadnięte z nazwy. Dopisanie czegoś, co już jest na liście, nic nie psuje
          — zwraca istniejącą pozycję; odhaczoną pozycję odznacza z powrotem.
        - `PATCH /supplies/{id}/check` — body `{ "checked": true|false }` (idempotentne);
          puste body przełącza.
        - `DELETE /supplies/{id}` — usuń pozycję; `POST /supplies/clear-checked` — usuń
          odhaczone; `POST /supplies/clear` — wyczyść całą listę (nieodwracalne).
        - `GET /supplies/hot` — sam ranking częstych rzeczy; `?all=true` zwraca wszystkie
          zapamiętane wpisy razem z ukrytymi (bez limitu).
        - `PATCH /supplies/hot/{id}` — `{ "pinned": true }` przypina na stałe,
          `{ "hidden": true }` chowa z podpowiedzi; `DELETE /supplies/hot/{id}` kasuje
          zliczenia (statystyki przeżywają usunięcie pozycji z listy — stąd ranking).

        ## Ćwiczenia (katalog treningowy, wspólny)

        Odczyt otwarty (jak przepisy), zapis z kluczem. Tokeny: `muscle` — abdominals,
        abductors, adductors, biceps, calves, chest, forearms, glutes, hamstrings, lats,
        lower-back, middle-back, neck, quadriceps, shoulders, traps, triceps · `equipment` —
        body-only, dumbbell, kettlebell, bands, barbell, ez-bar, cable, machine, medicine-ball,
        exercise-ball, foam-roll, other · `level` — beginner, intermediate, expert ·
        `category` — strength, stretching, plyometrics, cardio, powerlifting,
        olympic-weightlifting, strongman, pilates, yoga, mobility. Pełna lista:
        `GET /exercises/vocabulary`.

        - `GET /exercises?q=&muscle=&equipment=dumbbell,bands&level=&category=&location=home&enriched=false&video=true&limit=60&offset=0`
          — `{ total, enrichedTotal, catalogTotal, items[] }`. `muscle` łapie partię główną lub
          pomocniczą (główne pierwsze; `primaryOnly=true` tylko główne). `location=home` =
          sprzęt domowy. Ukryte pomijane (`includeHidden=true`).
        - `GET /exercises/{id}` — całość: `instructionsEn`, `instructionsPl`, `tipsPl`,
          `mistakesPl`, `youtubeId`, `videoTitle`, `imageUrls`, mięśnie, `isTimed`.
        - `PATCH /exercises/{id}` — częściowa zmiana (tylko podane pola): `namePl`,
          `instructionsPl`, `tipsPl`, `mistakesPl` (listy maks. 12 punktów, podmieniają całość),
          `youtubeId` (id lub link; `""` usuwa), `videoStartSeconds`, `isTimed`, `hidden`,
          `level`, `category`, `equipment`, `primaryMuscles`, `secondaryMuscles`.
        - `POST /exercises/enrich` — `{ "items": [ { "id": "…", "namePl": "…", … } ] }` (maks. 50);
          zwraca `{ updated, errors: [ { id, error } ] }` — każde ćwiczenie osobno.
        - `POST /exercises` — nowe ćwiczenie: `namePl` (wymagane), `primaryMuscles` (min. 1) i
          pola jak wyżej; duplikat nazwy → `409` z `id` istniejącego.
        - Film: serwer weryfikuje `youtubeId` w YouTube (oEmbed) — nieistniejący lub bez zgody
          na osadzanie → błąd dla tego ćwiczenia; tytuł i kanał zapisuje sam.
        - `GET /exercises/{id}/alternatives?direction=easier|similar|harder&location=home|gym|none&limit=8`
          — zamienniki (wspólna partia główna; `home` = sprzęt z ankiety + masa ciała).

        ## Trening — ankieta i plan (prywatne, per osoba)

        Tokeny: `goal` — lose-fat, tone, strength, mobility, general · `location` — home, gym,
        any · `styles` — strength, pilates, yoga, hiit, stretching, cardio · `kind` (dzień) —
        exercises, follow-along. `weekday`: 0 = poniedziałek … 6 = niedziela. Tydzień `n` to
        n-ty tydzień kalendarzowy od poniedziałku tygodnia `startDate`; dzień nie może wypaść
        przed `startDate`.

        - `GET /training/profile` / `PUT /training/profile` — `{ goal, level, daysPerWeek (1–7),
          minutesPerSession (10–180), preferredWeekdays (maska, bit 0 = pon), location,
          homeEquipment[], styles[], limitations, dislikes, notes }` (PUT: tylko podane pola).
          `configured: false` = jeszcze bez ankiety.
        - `GET /training/program` — aktywny plan (`204` gdy brak); `GET /training/programs` —
          lista; `GET /training/programs/{id}`.
        - `POST /training/programs` — `{ name, description?, rationale?, startDate?, weeks (1–26),
          activate?, createdBy?: "ai", days: [ { week, weekday, name, kind?, location?, notes?,
          videoYoutubeId?, videoMinutes?, workoutType?, exercises: [ { exerciseId, sets?,
          repsMin?, repsMax?, seconds?, restSeconds?, targetKg?, notes?, supersetGroup? } ] } ] }`.
          Jeden trening na dzień; `exercises` 1–20 (dzień `follow-along`: bez ćwiczeń, z filmem —
          sprawdzanym w YouTube). Powtórzenia ALBO `seconds`. Błąd wskazuje dzień:
          „Tydzień 2, wtorek: …”. `activate: true` archiwizuje poprzedni aktywny plan.
        - `POST /training/programs/template` (bez treści) — gotowy plan siłowy z ankiety, bez AI:
          6 tygodni od dziś, podział wg dni (całe ciało / góra–dół), ćwiczenia pod sprzęt i poziom,
          serie wg celu, progresja i lżejszy 6. tydzień; od razu aktywny. Bez ankiety → `400`;
          ankieta tylko z jogą/pilatesem → `422`. Ułożony z AI plan jest lepiej dopasowany — szablon
          to szybki start (albo jedyna droga bez Sous).
        - `PUT /training/programs/{id}` — pełna podmiana (te same pola).
          `PATCH /training/programs/{id}` — `{ name?, description?, rationale?, startDate?,
          status?: "active"|"draft"|"archived" }`. `DELETE /training/programs/{id}`.
        - `POST /training/programs/{id}/days` (dzień jak wyżej; zajęty termin → `409`),
          `PUT /training/programs/{id}/days/{dayId}` (podmiana dnia, id zostaje),
          `DELETE /training/programs/{id}/days/{dayId}`.
        - `PATCH /training/program-exercises/{id}` — `{ exerciseId?, sets?, repsMin?, repsMax?,
          seconds?, restSeconds?, targetKg?, clearTargetKg?, notes?, applyToFollowingWeeks? }`;
          zamiana ćwiczenia czyści `targetKg`, a przejście powtórzenia ↔ czas ustawia domyślne
          10–12 / 30 s. Zwraca `{ swapped, program }`.
        - `GET /training/today?date=YYYY-MM-DD` — `{ status: none|before-start|scheduled|rest|finished,
          program, week, day, next }`.

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
                2. Obejrzyj / przeczytaj źródło i wyciągnij przepis (link do strony lub PDF-a:
                   `POST {API}/import/url` albo narzędzie MCP `read_recipe_page`, dalsze strony PDF-a
                   `read_import_document`); znormalizuj go do schematu
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
                2. Wyciągnij surowe nazwy produktów spożywczych z ilościami metrycznymi
                   (g / ml / szt) oraz nazwę sklepu, jeśli jest widoczna. Pomiń produkty niespożywcze.
                3. Pokaż mi listę do zatwierdzenia, potem:
                   - paragon → `POST {API}/pantry/adjust` z deltami (ile doszło);
                   - zdjęcie lodówki → `POST {API}/pantry/bulk` z ilościami absolutnymi (ile jest).
                4. Pozycje z `notInCatalog`: wariant czegoś z katalogu → ponów adjust z
                   właściwym `pantryItemId`, aby zapamiętać mapowanie paragonowe; nowy stały
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
            ["wzbogac-cwiczenia.md"] = T("""
                Dopisz polskie opisy i filmy do ćwiczeń w katalogu Pichci. Ile lub które: $ARGUMENTS
                (liczba = tyle ćwiczeń, domyślnie 10; nazwa partii lub sprzętu = zacznij od nich).

                1. Przeczytaj sekcję „Trening — katalog ćwiczeń” w `{CTX}/AGENTS.md`.
                2. Wybierz ćwiczenia bez opisu: `search_exercises` z `enriched: false` (albo
                   `GET {API}/exercises?enriched=false`). Kolejność: sprzęt domowy (`location: home`)
                   przed siłownią, poziom beginner/intermediate przed expert, popularne ruchy
                   (przysiady, wykroki, hip thrust, martwy ciąg, wiosłowanie, pompki, plank) przed niszowymi.
                3. Dla każdego: `get_exercise`, a potem napisz po polsku `namePl`, `instructionsPl`
                   (3–6 kroków), `tipsPl` (2–4 „Na co uważać”) i `mistakesPl` (2–4 „Częste błędy”).
                4. Znajdź w wyszukiwarce krótki film instruktażowy z dokładnie tym ćwiczeniem (najpierw
                   po polsku, potem po angielsku) i podaj jego link jako `youtubeId`. Nie zgaduj id;
                   bez wyszukiwarki pomiń film. Ćwiczenie niszowe lub dublujące inne → `hidden: true`.
                5. Zapisuj partiami po 5–10 przez `enrich_exercises` (`POST {API}/exercises/enrich`).
                   Ćwiczenia z `errors` (np. odrzucony film) popraw i wyślij ponownie albo zapisz bez filmu.
                6. Na koniec podaj, ile opisano, ile z filmem i co pominięto.
                """),
            ["plan-treningowy.md"] = T("""
                Ułóż albo dostosuj mój plan treningowy w Pichci. Wytyczne: $ARGUMENTS
                („dostosuj” = popraw kolejne tygodnie istniejącego planu; inaczej nowy plan).

                1. Przeczytaj sekcje „Trening” w `{CTX}/AGENTS.md`.
                2. `get_training_profile` (`GET {API}/training/profile`). Bez ankiety (`configured:
                   false`) zadaj mi po kolei: cel, poziom, ile dni i minut, które dni, gdzie ćwiczę
                   i jaki mam sprzęt, style (siłowy, pilates, joga…), kontuzje, czego nie lubię —
                   i zapisz `set_training_profile`.
                3. `get_training_program` — sprawdź, czy jest aktywny plan (przy „dostosuj” to on
                   jest punktem wyjścia; zachowaj minione tygodnie bez zmian).
                4. Dobierz ćwiczenia `search_exercises` (`location: home` dla dni w domu, filtr
                   `muscle`), zaczynając od złożonych ruchów; unikaj tego, co koliduje z kontuzjami.
                   Dni z filmem (pilates/joga) — tylko z filmem znalezionym w wyszukiwarce.
                5. Pokaż propozycję: podział tygodnia, tydzień 1 (ćwiczenia, serie × powtórzenia,
                   przerwy) i jak plan rośnie w kolejnych tygodniach. Poczekaj na moją zgodę.
                6. Zapisz `create_training_program` z `activate: true` (przy „dostosuj”:
                   `replace_training_program`) i krótkim `rationale`. Błąd walidacji wskazuje dzień —
                   popraw go i ponów.
                """),
            ["zdjecia-przepisow.md"] = T("""
                Dodaj zdjęcia dań do przepisów Pichci, które ich nie mają. Zakres: $ARGUMENTS
                (puste = wszystkie przepisy bez zdjęcia).

                1. Przeczytaj w `{CTX}/AGENTS.md` sekcję „Zdjęcie dania, gdy przepis go nie ma” — styl
                   i prompt są tam; trzymaj się ich dokładnie, żeby wszystkie zdjęcia były spójne.
                   Używaj narzędzi MCP `pichci` (sprawdź ich schemat, nie zgaduj parametrów); REST API
                   tylko, gdy MCP nie ma.
                2. Znajdź przepisy bez zdjęcia: `search_recipes` z `hasImage: false`
                   (`GET {API}/recipes?hasImage=false`). Do każdego `get_recipe` — opis dania do promptu
                   bierz z jego składników i kroków, żeby zdjęcie pokazywało ten przepis.
                3. Generuj partiami po 6–10. Każdy obraz zapisz w katalogu roboczym pod czytelną
                   nazwą z tytułu (np. `zdjecia/szakszuka-z-feta.png`); sprawdź, że plik istnieje i ma
                   mniej niż 5 MB.
                4. Zrób kontaktówkę partii (miniatury z tytułami) i obejrzyj ją: właściwe danie, jeden
                   styl, bez tekstu, dłoni i artefaktów. Nieudane wygeneruj ponownie.
                5. Dopiero potem dołącz zdjęcia: `add_recipe_image` (`id` + `filePath`) albo
                   `POST {API}/recipes/{id}/image` (multipart `file`).
                6. Sprawdź `get_recipe` / `search_recipes`, że `imageUrl` jest zapisane.
                7. Na koniec wypisz, które przepisy dostały zdjęcia i ile zostało bez zdjęcia.
                """),
        };
    }

    /// <summary>
    /// In-app Sous on Codex: sent once, at the start of a Codex thread. Codex also loads
    /// AGENTS.md from the context folder it runs in.
    /// </summary>
    public static string SousInstructions(string personName) => """
        Jesteś Sous — asystent kulinarny i dietetyczny w aplikacji Pichci. Rozmawiasz w panelu
        czatu w aplikacji (najczęściej na telefonie) z osobą: {PERSON}.

        - Bieżący folder to kontekst kuchni: AGENTS.md (zasady — stosuj się), cookbook.md,
          pantry.json, plan.md, cooklog.md, recipes/, supplies.md. Czytaj tylko to, czego
          potrzebujesz do odpowiedzi.
        - Wszystko, co zmienia dane, i wszystko z dziennika (zjedzone, budżet kcal, waga,
          aktywność) robisz narzędziami MCP `pichci`. Działają w imieniu {PERSON}. Nie masz
          sieci ani zapisu plików — nie próbuj curl ani edycji plików.
        - Link do przepisu (strona albo PDF) przeczytaj `read_recipe_page` — serwer pobiera go za
          ciebie. Załącznik PDF z czatu czytaj `read_import_document` (kolejne strony od
          `nextPage`). Z każdego przepisu zrób propozycję wg zasad z AGENTS.md (po polsku,
          dokładne ilości, czasy i temperatury, kcal i makro na porcję), pokaż ją i po zgodzie
          zapisz `add_recipe` (source "web", sourceName = nazwa strony, autora lub książki),
          a zdjęcie dania z `imageUrl` dołącz `add_recipe_image`. Przy wielu przepisach (cały
          PDF) najpierw wypisz ich listę i zapytaj, które dodać; zapisuj po kilka i pomijaj te,
          które już są w książce. Strony z błędem albo skany — powiedz wprost, co nie wyszło.
        - Zdjęcie dania: przepis bez zdjęcia (`imageUrl` puste; lista: `search_recipes` z
          `hasImage: false`) dostaje wygenerowane zdjęcie, gdy o nie poproszę — a po zapisaniu
          nowego przepisu bez zdjęcia zapytaj, czy je zrobić. Generuj wbudowanym narzędziem do
          obrazów dokładnie wg sekcji „Zdjęcie dania, gdy przepis go nie ma” z AGENTS.md (styl
          i prompt), z opisem dania ze składników i kroków (`get_recipe`). Plik zapisuje się
          w `$CODEX_HOME/generated_images/…` — dołącz go `add_recipe_image` z `filePath`.
          Najwyżej 3 zdjęcia na wiadomość (zużywają limit planu); przy większej liczbie zrób
          3 i zapytaj, czy dalej. W czacie nie widać obrazków: napisz, które przepisy mają nowe
          zdjęcie, żebym je obejrzał(a) — nieudane usunę w galerii przepisu. Przepisu, który
          ma już zdjęcie, nie ruszaj, chyba że wyraźnie poproszę o nowe.
        - Proste dopisanie (zjedzone jedzenie, pozycja na liście zakupów, ważenie) wykonaj od
          razu i potwierdź jednym zdaniem z liczbami (np. ile kcal zostało na dziś).
          Usuwanie, czyszczenie list, podmiana przepisu, zmiana celu i nowy przepis — najpierw
          pokaż propozycję i poczekaj na zgodę.
        - Odpowiadaj po polsku, krótko i konkretnie, jak w komunikatorze. Czat pokazuje zwykły
          tekst: bez nagłówków, tabel, pogrubień i bloków kodu; listy jako linie zaczynające
          się od „– ”. Nie pokazuj identyfikatorów ani JSON-a.
        - Gdy czegoś nie wiesz (np. ile czegoś zjedzono), dopytaj jednym pytaniem zamiast
          zgadywać — chyba że rozsądne oszacowanie wystarczy; wtedy powiedz, że to szacunek.
        - Trening: ankieta, plan i „co dziś” są w narzędziach `*_training_*` (zasady w AGENTS.md,
          sekcje „Trening”). Plan możesz ułożyć i zmieniać. Polskie opisy i filmy ćwiczeń
          aplikacja dopisuje sama w tle (najpierw z nowego planu) — nie pisz ich przy układaniu
          planu. Film do dnia „z filmem” (pilates, joga) znajdź wyszukiwarką; adres podaj tylko
          z wyników, nigdy nie zgaduj (serwer go sprawdza).
        """.Replace("{PERSON}", personName);

    /// <summary>Every Sous turn: the date (threads outlive days) plus the recipe on screen, if any.</summary>
    public static string SousTurn(DateTime now, string personName, string message, string? recipeFocus)
    {
        var day = new[] { "niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota" }[(int)now.DayOfWeek];
        var header = $"[Pichci · {day} {now:yyyy-MM-dd}, godz. {now:HH:mm} · pisze: {personName}]";
        var focus = recipeFocus is null
            ? ""
            : "\n[Na ekranie jest ten przepis — odpowiadaj w jego kontekście, chyba że pytanie dotyczy czegoś innego]\n"
              + recipeFocus + "\n";
        return $"{header}{focus}\n{message}";
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
        # Claude Code (komendy /dodaj-przepis, /paragon, /zaplanuj-tydzien, /wzbogac-cwiczenia, /plan-treningowy, /zdjecia-przepisow)
        cp "{CTX}/commands/"*.md ~/.claude/commands/

        # Codex CLI
        cp "{CTX}/commands/"*.md ~/.codex/prompts/

        # Windows PowerShell:
        #   Copy-Item "{CTX}\commands\*.md" "$HOME\.claude\commands\"
        #   Copy-Item "{CTX}\commands\*.md" "$HOME\.codex\prompts\"
        """.Replace("{CTX}", contextDir);
}
