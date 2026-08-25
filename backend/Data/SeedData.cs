using Microsoft.EntityFrameworkCore;
using Mise.Api.Domain;

namespace Mise.Api.Data;

/// <summary>
/// Seeds the database (in Polish) so the app looks alive on first run. The pantry
/// catalog seeds whenever the pantry table is empty (also after a fresh-start wipe);
/// recipes and the cooking profile seed only on a brand-new install.
/// </summary>
public static class SeedData
{
    public static async Task EnsureSeededAsync(MiseDbContext db, CancellationToken ct = default)
    {
        // Every item starts at quantity 0: the catalog says what we track, the real
        // amounts arrive via receipt scans / manual edits. Links from seeded recipes
        // use the keys directly; on reseed DbInitializer's relink pass takes over.
        var pantry = new Dictionary<string, PantryItem>();
        if (!await db.PantryItems.AnyAsync(ct))
        {
            void P(string key, string name, PantryCategory cat, PantryUnit unit,
                decimal? low = null, string aliases = "")
                => pantry[key] = new PantryItem
                {
                    Name = name, Category = cat, Unit = unit,
                    Quantity = 0, LowThreshold = low, Aliases = aliases,
                };

            P("tomatoes", "Pomidorki koktajlowe", PantryCategory.Produce, PantryUnit.G, 150);
            P("basil", "Świeża bazylia", PantryCategory.Produce, PantryUnit.G, null, "bazylia");
            P("garlic", "Czosnek", PantryCategory.Produce, PantryUnit.Szt, 1);
            P("onion", "Cebula", PantryCategory.Produce, PantryUnit.Szt, 2);
            P("lemon", "Cytryny", PantryCategory.Produce, PantryUnit.Szt, 1, "cytryna");
            P("asparagus", "Szparagi", PantryCategory.Produce, PantryUnit.G);
            P("carrots", "Marchew", PantryCategory.Produce, PantryUnit.G, 200, "marchewka");
            P("pepper", "Papryka", PantryCategory.Produce, PantryUnit.Szt, 1, "papryka czerwona");
            P("springonion", "Dymka", PantryCategory.Produce, PantryUnit.Szt);
            P("potatoes", "Ziemniaki", PantryCategory.Produce, PantryUnit.G, 500);
            P("cucumber", "Ogórki", PantryCategory.Produce, PantryUnit.Szt, null, "ogórek");
            P("eggs", "Jajka", PantryCategory.Fridge, PantryUnit.Szt, 4);
            P("halloumi", "Halloumi", PantryCategory.Fridge, PantryUnit.G);
            P("chicken", "Udka z kurczaka", PantryCategory.Fridge, PantryUnit.Szt);
            P("salmon", "Filety z łososia", PantryCategory.Fridge, PantryUnit.Szt, null, "łosoś");
            P("parmesan", "Parmezan", PantryCategory.Fridge, PantryUnit.G, 40);
            P("butter", "Masło", PantryCategory.Fridge, PantryUnit.G, 60);
            P("yogurt", "Jogurt grecki", PantryCategory.Fridge, PantryUnit.G, 150, "jogurt");
            P("guanciale", "Guanciale", PantryCategory.Fridge, PantryUnit.G);
            P("milk", "Mleko", PantryCategory.Fridge, PantryUnit.Ml, 500, "mleko 2%;mleko 3,2%");
            P("cream", "Śmietanka 30%", PantryCategory.Fridge, PantryUnit.Ml, null, "śmietana;śmietanka");
            P("feta", "Feta", PantryCategory.Fridge, PantryUnit.G);
            P("mozzarella", "Mozzarella", PantryCategory.Fridge, PantryUnit.G);
            P("gnocchi", "Gnocchi", PantryCategory.Pantry, PantryUnit.G);
            P("spaghetti", "Spaghetti", PantryCategory.Pantry, PantryUnit.G, 200);
            P("pasta", "Makaron", PantryCategory.Pantry, PantryUnit.G, 200, "penne;fusilli;tagliatelle");
            P("chickpeas", "Ciecierzyca (z puszki)", PantryCategory.Pantry, PantryUnit.Szt, 1, "ciecierzyca");
            P("cantom", "Pomidory (z puszki)", PantryCategory.Pantry, PantryUnit.Szt, 1, "passata");
            P("oliveoil", "Oliwa z oliwek", PantryCategory.Pantry, PantryUnit.Ml, 100, "oliwa");
            P("oil", "Olej rzepakowy", PantryCategory.Pantry, PantryUnit.Ml, 100, "olej");
            P("soy", "Sos sojowy", PantryCategory.Pantry, PantryUnit.Ml, 50);
            P("gochujang", "Gochujang", PantryCategory.Pantry, PantryUnit.G, 30);
            P("tahini", "Tahini", PantryCategory.Pantry, PantryUnit.G, 50);
            P("honey", "Miód", PantryCategory.Pantry, PantryUnit.G, 50);
            P("wraps", "Tortille", PantryCategory.Pantry, PantryUnit.Szt, 2, "tortilla;wrapy");
            P("misopaste", "Pasta miso", PantryCategory.Pantry, PantryUnit.G, 30, "miso");
            P("flour", "Mąka pszenna", PantryCategory.Pantry, PantryUnit.G, 300, "mąka");
            P("sugar", "Cukier", PantryCategory.Pantry, PantryUnit.G, 200);
            P("rice", "Ryż", PantryCategory.Pantry, PantryUnit.G, 200);
            P("cumin", "Kmin rzymski", PantryCategory.Spices, PantryUnit.G, null, "kmin");
            P("paprika", "Papryka mielona", PantryCategory.Spices, PantryUnit.G, null, "papryka słodka;papryka wędzona");
            P("chilli", "Płatki chilli", PantryCategory.Spices, PantryUnit.G, null, "chilli");
            P("salt", "Sól", PantryCategory.Spices, PantryUnit.G);
            P("blackpepper", "Pieprz czarny", PantryCategory.Spices, PantryUnit.G, null, "czarny pieprz;pieprz");
            P("oregano", "Oregano", PantryCategory.Spices, PantryUnit.G);
            P("sesame", "Sezam", PantryCategory.Spices, PantryUnit.G);

            db.PantryItems.AddRange(pantry.Values);
        }

        // Starter vocabulary for the household list's quick-add chips. AddCount 0 means
        // they score 0 and sit at the tail of the hot row, so real usage displaces them
        // without any special-casing in the ranking. Seeds whenever the table is empty,
        // like the pantry catalog — the SupplyItems list itself is never seeded.
        if (!await db.SupplyFavorites.AnyAsync(ct))
        {
            void S(string name, SupplyCategory cat)
                => db.SupplyFavorites.Add(new SupplyFavorite
                {
                    Name = name,
                    NormalizedName = Services.SupplyService.Key(name),
                    Category = cat,
                });

            S("Papier toaletowy", SupplyCategory.Paper);
            S("Ręczniki papierowe", SupplyCategory.Paper);
            S("Chusteczki higieniczne", SupplyCategory.Paper);
            S("Płyn do naczyń", SupplyCategory.Cleaning);
            S("Tabletki do zmywarki", SupplyCategory.Cleaning);
            S("Proszek do prania", SupplyCategory.Cleaning);
            S("Płyn do płukania", SupplyCategory.Cleaning);
            S("Worki na śmieci", SupplyCategory.Kitchen);
            S("Gąbki do naczyń", SupplyCategory.Kitchen);
            S("Folia aluminiowa", SupplyCategory.Kitchen);
            S("Mydło w płynie", SupplyCategory.Hygiene);
            S("Szampon", SupplyCategory.Hygiene);
            S("Pasta do zębów", SupplyCategory.Hygiene);
        }

        if (await db.Recipes.AnyAsync(ct))
        {
            await db.SaveChangesAsync(ct);
            return;
        }

        var prefs = new Preferences
        {
            Id = 1,
            HouseholdSummary = "2 osoby",
            HouseholdDetail = "Kolacje przez większość dni, spokojniej w weekendy.",
            SkillSummary = "Średnio zaawansowany",
            SkillDetail = "Ok. 30–40 min w dni powszednie.",
            TasteCuisines =
                "Jemy wszystko. Lubimy wyraziste i ostre smaki — koreańska, śródziemnomorska i bliskowschodnia to ulubione.\n" +
                "Miski warzywne zawsze mile widziane.",
            AvoidDietary =
                "Bez ścisłych ograniczeń. Mało cukru dodanego i bez bardzo długich, dłubanych przepisów w tygodniu.",
            EquipmentNote = "Frytkownica beztłuszczowa jest ulubiona — preferuj metody z frytkownicy, gdy to ma sens.",
            Equipment = new()
            {
                new EquipmentItem { Name = "Frytkownica beztłuszczowa", Favorite = true, Order = 0 },
                new EquipmentItem { Name = "Piekarnik", Order = 1 },
                new EquipmentItem { Name = "Kuchenka gazowa", Order = 2 },
                new EquipmentItem { Name = "Blender", Order = 3 },
                new EquipmentItem { Name = "Patelnia żeliwna", Order = 4 },
            },
        };
        db.Preferences.Add(prefs);

        Recipe R(string title, RecipeSource source, int time, string difficulty, string tint,
            DishType dish, Cuisine cuisine,
            string blurb, (string name, string qty, string? key)[] ings, string[] steps, string tip)
        {
            var recipe = new Recipe
            {
                Title = title,
                Source = source,
                TimeMinutes = time,
                Servings = 2,
                Difficulty = difficulty,
                Tint = tint,
                DishType = dish,
                Cuisine = cuisine,
                Blurb = blurb,
                Tip = tip,
            };
            for (var i = 0; i < ings.Length; i++)
            {
                var (name, qty, key) = ings[i];
                recipe.Ingredients.Add(new RecipeIngredient
                {
                    Name = name,
                    Quantity = qty,
                    Order = i,
                    // Null when the pantry pre-exists (recipes-only seed); the
                    // DbInitializer relink pass fills the link at startup.
                    PantryItem = key is not null ? pantry.GetValueOrDefault(key) : null,
                });
            }
            for (var i = 0; i < steps.Length; i++)
                recipe.Steps.Add(new RecipeStep { Order = i, Text = steps[i] });
            return recipe;
        }

        db.Recipes.AddRange(
            R("Chrupiące gnocchi z frytkownicy z pomidorkami", RecipeSource.Ai, 20, "Łatwe", "#c2683a",
                DishType.Main, Cuisine.Italian,
                "Gotowe gnocchi prosto do frytkownicy, aż będą złociste i chrupiące, wymieszane z czosnkowymi, podduszonymi pomidorkami i świeżą bazylią. 20-minutowy bohater dnia powszedniego.",
                new[]
                {
                    ("gnocchi", "500 g", (string?)"gnocchi"),
                    ("pomidorki koktajlowe", "300 g", "tomatoes"),
                    ("czosnek", "3 ząbki", "garlic"),
                    ("oliwa z oliwek", "2 łyżki", "oliveoil"),
                    ("bazylia", "garść", "basil"),
                    ("parmezan", "do podania", "parmesan"),
                },
                new[]
                {
                    "Wymieszaj gnocchi z 1 łyżką oliwy i smaż we frytkownicy w 200°C przez 12 min, potrząsając w połowie, aż napęcznieją i będą chrupiące.",
                    "W tym czasie przekrój pomidorki i poddusz je z plasterkami czosnku oraz resztą oliwy na patelni, 6–7 min, aż zmiękną.",
                    "Wmieszaj chrupiące gnocchi w pomidory, dopraw i wykończ porwaną bazylią oraz startym parmezanem.",
                },
                "Nie trzeba wcześniej gotować gnocchi — prosto z opakowania do kosza. Nie przepełniaj; pojedyncza warstwa daje najbardziej chrupiące brzegi."),

            R("Koreański kurczak gochujang z frytkownicy", RecipeSource.Ai, 35, "Łatwe", "#b34626",
                DishType.Main, Cuisine.Korean,
                "Lepki, ostry i głęboko wytrawny — udka z kurczaka smażone we frytkownicy, a potem obtoczone w glazurze gochujang z miodem, sezamem i dymką.",
                new[]
                {
                    ("udka z kurczaka", "6 bez kości", (string?)"chicken"),
                    ("gochujang", "2 łyżki", "gochujang"),
                    ("sos sojowy", "1 łyżka", "soy"),
                    ("miód", "1 łyżka", "honey"),
                    ("czosnek", "2 ząbki", "garlic"),
                    ("dymka", "2", "springonion"),
                },
                new[]
                {
                    "Osusz udka, wymieszaj z odrobiną oliwy i soli i smaż we frytkownicy w 200°C przez 18–20 min, aż będą dopieczone i chrupiące.",
                    "Wymieszaj gochujang, sos sojowy, miód i starty czosnek na glazurę.",
                    "Obtocz gorącego kurczaka w glazurze, wstaw do frytkownicy na 2 min, aby się związała, a potem posyp dymką i sezamem.",
                },
                "Na ostatnie minuty ułóż skórą do góry dla dodatkowej chrupkości. Glazura szybko się przypala — dodaj ją dopiero na końcu."),

            R("Łosoś ze szparagami z jednej blachy", RecipeSource.Web, 30, "Łatwe", "#5f7a52",
                DishType.Main, Cuisine.Mediterranean,
                "Czysty, świeży obiad z jednej blachy: łosoś pieczony obok szparagów z cytryną i czosnkiem. Minimum wysiłku i zmywania.",
                new[]
                {
                    ("filety z łososia", "2", (string?)"salmon"),
                    ("szparagi", "1 pęczek", "asparagus"),
                    ("cytryna", "1", "lemon"),
                    ("oliwa z oliwek", "2 łyżki", "oliveoil"),
                    ("czosnek", "2 ząbki", "garlic"),
                },
                new[]
                {
                    "Rozgrzej piekarnik do 200°C. Rozłóż szparagi na blasze z oliwą, czosnkiem i przyprawami.",
                    "Ułóż łososia, na wierzch plasterki cytryny i piecz 12–14 min, aż ryba będzie się rozpadać.",
                    "Wykończ skropieniem cytryną i płatkami soli.",
                },
                "Świetnie wychodzi też we frytkownicy w 180°C — ryba 9 min, szparagi 6 min w drugiej partii."),

            R("Shakshuka dla dwojga", RecipeSource.Manual, 25, "Łatwe", "#bd5230",
                DishType.Main, Cuisine.MiddleEastern,
                "Jajka zapiekane w pikantnym sosie z pomidorów i papryki. Nasz niezawodny leniwy obiad, prawie w całości ze spiżarni.",
                new[]
                {
                    ("jajka", "4", (string?)"eggs"),
                    ("pomidory z puszki", "1 puszka", "cantom"),
                    ("papryka", "1", "pepper"),
                    ("cebula", "1", "onion"),
                    ("kmin rzymski", "1 łyżeczka", "cumin"),
                    ("feta", "do podania", null),
                },
                new[]
                {
                    "Zeszklij pokrojoną cebulę i paprykę na oliwie, 8 min. Dodaj kmin rzymski i paprykę mieloną, smaż 1 min.",
                    "Wlej pomidory, gotuj 8 min, aż sos zgęstnieje, i dobrze dopraw.",
                    "Zrób wgłębienia, wbij jajka, przykryj i gotuj, aż się zetną. Pokrusz na wierzch fetę.",
                },
                "To nie danie do frytkownicy — ale sos trzyma się kilka dni, więc zrób podwójną porcję na kuchence."),

            R("Miska z halloumi i ciecierzycą z frytkownicy", RecipeSource.Ai, 25, "Łatwe", "#a9772e",
                DishType.Main, Cuisine.Mediterranean,
                "Złociste halloumi i chrupiąca ciecierzyca z frytkownicy na papryce, z cytrynowym jogurtem. Dowolnie modyfikuj według tego, co masz.",
                new[]
                {
                    ("halloumi", "1 kostka", (string?)"halloumi"),
                    ("ciecierzyca", "1 puszka", "chickpeas"),
                    ("papryka", "1", "pepper"),
                    ("oliwa z oliwek", "1 łyżka", "oliveoil"),
                    ("cytryna", "1/2", "lemon"),
                    ("jogurt grecki", "3 łyżki", "yogurt"),
                },
                new[]
                {
                    "Wymieszaj odsączoną ciecierzycę i pokrojoną paprykę z oliwą i przyprawami; smaż we frytkownicy w 200°C przez 12 min.",
                    "Dodaj pokrojone halloumi na ostatnie 6 min, aż się zezłoci.",
                    "Przełóż do misek i polej jogurtem z cytryną.",
                },
                "Dobrze osusz ciecierzycę przed smażeniem — to sekret chrupkości, a nie rozmięknięcia."),

            R("Marchewki pieczone w maśle miso", RecipeSource.Web, 30, "Łatwe", "#c47a2e",
                DishType.Side, Cuisine.Japanese,
                "Słono-słodki dodatek, który je się jak danie główne — marchew glazurowana w maśle miso, aż skarmelizuje się na brzegach.",
                new[]
                {
                    ("marchew", "500 g", (string?)"carrots"),
                    ("pasta miso", "1 łyżka", "misopaste"),
                    ("masło", "30 g", "butter"),
                    ("sos sojowy", "1 łyżeczka", "soy"),
                },
                new[]
                {
                    "Rozpuść masło z miso i sosem sojowym. Wymieszaj z przekrojoną marchewką.",
                    "Smaż we frytkownicy w 190°C przez 18–20 min, raz potrząsając, aż będzie miękka i oblukrowana.",
                    "Wykończ sezamem i dymką.",
                },
                "Frytkownica karmelizuje je szybciej niż piekarnik — pilnuj ostatnich minut, żeby miso się nie przypaliło."),

            R("Szybka carbonara", RecipeSource.Manual, 20, "Średnie", "#9c6b3e",
                DishType.Main, Cuisine.Italian,
                "Po właściwemu, z żółtek i pecorino, bez śmietany. Nasz wybór, gdy chcemy szybkiego komfortu.",
                new[]
                {
                    ("spaghetti", "200 g", (string?)"spaghetti"),
                    ("jajka", "2 żółtka + 1", "eggs"),
                    ("parmezan", "60 g", "parmesan"),
                    ("czarny pieprz", "dużo", null),
                    ("guanciale", "100 g", "guanciale"),
                },
                new[]
                {
                    "Podsmaż pokrojone guanciale na suchej patelni. Ugotuj spaghetti al dente.",
                    "Roztrzep żółtka ze startym serem i dużą ilością pieprzu.",
                    "Wymieszaj odsączony makaron z dala od ognia z guanciale, potem z masą jajeczną, rozluźniając wodą z gotowania, aż będzie aksamitny.",
                },
                "Masę jajeczną dodaj z dala od ognia — za gorąco i zrobi się jajecznica. (Bez frytkownicy, niestety.)"),

            R("Chrupiące wrapy z falafelem z frytkownicy", RecipeSource.Ai, 30, "Średnie", "#7d8a4d",
                DishType.Main, Cuisine.MiddleEastern,
                "Ziołowy falafel z ciecierzycy z frytkownicy, zawinięty w ciepłe tortille z tahini i szybko marynowanymi warzywami.",
                new[]
                {
                    ("ciecierzyca", "1 puszka", (string?)"chickpeas"),
                    ("tahini", "2 łyżki", "tahini"),
                    ("kmin rzymski", "1 łyżeczka", "cumin"),
                    ("czosnek", "2 ząbki", "garlic"),
                    ("tortille", "4", "wraps"),
                    ("jogurt grecki", "3 łyżki", "yogurt"),
                },
                new[]
                {
                    "Zmiksuj odsączoną ciecierzycę z czosnkiem, ziołami, kminem i odrobiną mąki. Uformuj kotleciki.",
                    "Smaż we frytkownicy w 190°C przez 14 min, raz obracając, aż będą chrupiące.",
                    "Zawiń w ciepłe tortille z jogurtem-tahini i marynowanymi warzywami.",
                },
                "Użyj ciecierzycy z puszki (nie moczonej) i dodaj 1 łyżkę mąki, żeby trzymała się w koszu."));

        db.ChatMessages.Add(new ChatMessage
        {
            SessionId = "default",
            Role = "ai",
            Content = "Dobry wieczór! Zerknąłem do Twojej spiżarni — masz pod dostatkiem udek z kurczaka, gnocchi, jajek i ciecierzycy. Mam ogarnąć dzisiejszą kolację, czy zaplanować kilka dni do przodu?",
        });

        await db.SaveChangesAsync(ct);
    }
}
