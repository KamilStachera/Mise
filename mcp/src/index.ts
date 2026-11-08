#!/usr/bin/env node
// MCP server "pichci" — first-class tools over the Pichci cookbook REST API for
// Claude Code / Codex. The exported ./context folder stays the primary READ
// path; these tools are for writes and quick queries when the folder isn't open.
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { del, get, patch, post, put } from './api.js'

const server = new McpServer({ name: 'pichci', version: '1.0.0' })

const text = (data: unknown) => ({
  content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
})

const DISH_TYPES = ['breakfast', 'main', 'soup', 'salad', 'side', 'dessert', 'snack', 'baking'] as const
const UNITS = ['g', 'ml', 'szt'] as const
const PANTRY_CATEGORIES = ['produce', 'fridge', 'pantry', 'spices'] as const
const SUPPLY_CATEGORIES = ['cleaning', 'hygiene', 'paper', 'kitchen', 'pets', 'other'] as const
const CUISINES = [
  'polish', 'italian', 'french', 'spanish', 'greek', 'mediterranean', 'middleeastern',
  'indian', 'thai', 'vietnamese', 'chinese', 'japanese', 'korean', 'mexican', 'american', 'other',
] as const

const recipeInputShape = {
  title: z
    .string()
    .describe(
      'Tytuł przepisu (po polsku) — nazwa dania, NIE lista elementów posiłku ' +
        '("Jajecznica; pieczywo; gruszka" ✗ → "Jajecznica z pieczywem i warzywami" ✓)',
    ),
  source: z.enum(['ai', 'web', 'manual']).describe('ai = kreacja AI, web = książka/strona, manual = własne'),
  sourceName: z
    .string()
    .max(80)
    .optional()
    .describe(
      'Skąd przepis: książka, strona, jadłospis (np. "Daily Dieta"); pokazywane nad tytułem. ' +
        'Nie doklejaj do tytułu. Przy pełnej podmianie zachowaj wartość z odczytu.',
    ),
  time: z.number().int().positive().describe('Czas przygotowania w minutach'),
  servings: z.number().int().positive().describe('Liczba porcji (domyślnie 2)'),
  difficulty: z.string().optional().describe('Łatwe / Średnie / Trudne'),
  tint: z.string().optional().describe('Kolor karty przepisu, np. #c0552d; przy pełnej podmianie zachowaj wartość z odczytu'),
  dishType: z.enum(DISH_TYPES).optional().describe('Rodzaj dania — zawsze ustawiaj; napędza filtry biblioteki'),
  cuisine: z.enum(CUISINES).optional().describe('Kuchnia/pochodzenie — zawsze ustawiaj; "other" gdy żadna nie pasuje'),
  usesAirFryer: z
    .boolean()
    .optional()
    .describe('Czy danie robi się we frytkownicy beztłuszczowej — zawsze ustawiaj (true/false); pominięte = zgadywanie z tekstu'),
  kcal: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Szacunkowe kcal NA JEDNĄ PORCJĘ (jedna osoba; całe danie ÷ servings) — zawsze oszacuj. ' +
        'Zawsze komplet: kcal+protein+fat+carbs, nigdy samo kcal — gdy źródło podaje ' +
        'tylko kalorie, resztę policz ze składników',
    ),
  protein: z.number().positive().optional().describe('Białko w gramach NA PORCJĘ (szacunek) — zawsze oszacuj, razem z fat i carbs'),
  fat: z.number().positive().optional().describe('Tłuszcz w gramach NA PORCJĘ (szacunek) — zawsze oszacuj, razem z protein i carbs'),
  carbs: z.number().positive().optional().describe('Węglowodany w gramach NA PORCJĘ (szacunek) — zawsze oszacuj, razem z protein i fat'),
  blurb: z.string().optional().describe('Jedno-dwa zdania opisu'),
  tip: z.string().optional().describe(
    'Wskazówka (opcjonalna), ale precyzyjna: bez „odrobiny”, „kilku minut” i innych wartości bez liczby',
  ),
  ingredients: z
    .array(
      z.object({
        name: z.string().describe('Kanoniczna nazwa produktu ze spiżarni, bez ilości i bez opisu przygotowania'),
        quantity: z.string().optional().describe(
          'Dokładna ilość, pokazywana osobno po prawej, np. "100 g", "2 szt."; nie używaj pustej wartości, „do smaku”, „szczypty”, „odrobiny” ani „garści” bez liczby',
        ),
        displayText: z.string().optional().describe(
          'Oryginalny pełny wiersz ze źródła, gdy zawiera dodatkowe informacje, np. "2–4 kromki chleba na zakwasie piwnym"; UI pokazuje go jako doprecyzowanie pod kanonicznym name',
        ),
        alternativeGroup: z.string().optional().describe(
          'Wspólny klucz dla zamienników typu A lub B. Każda opcja jest osobnym składnikiem z tą samą wartością, np. Marchew i Cukinia z alternativeGroup: "warzywo"',
        ),
        amountValue: z.number().positive().optional(),
        amountUnit: z.enum(UNITS).optional(),
      }),
    )
    .describe(
      'Składniki — naturalne polskie nazwy W MIANOWNIKU, jak mówi się w kuchni, nie z bazy żywieniowej ' +
        'ani z dopełniacza ("Jaja kurze całe" + "100 g" ✗ → name: "Jajka", quantity: "2 szt." ✓; ' +
        '"Mięso z piersi indyka, bez skóry" → "Pierś z indyka"; "Miodu" → "Miód"). Ilość nigdy nie jest ' +
        'częścią nazwy ("Łyżeczka pasty gochujang" → name: "Pasta gochujang", quantity: "1 łyżeczka"). ' +
        'name to kanoniczny produkt ze spiżarni (np. "Pieczywo"), quantity jest wyświetlane osobno po prawej, ' +
        'a displayText zachowuje pełne oryginalne brzmienie ' +
        'z przepisu (np. "2 kromki chleba na zakwasie"). quantity to sama naturalna ilość ' +
        '("2 kromki (70 g)", nie "2 x Kromka (70.0 g)"); ' +
        'amountValue+amountUnit to ilość strukturalna (napędza "czy wystarczy w spiżarni" i odejmowanie ' +
        'po ugotowaniu) — ZAWSZE podawaj, gdy ilość jest mierzalna (np. name: "Guanciale", quantity: "100 g", ' +
        'amountValue: 100, amountUnit: "g"). PRECYZJA JEST OBOWIĄZKOWA: nie zapisuj pustej quantity, ' +
        '"do smaku", "szczypty", "odrobiny", "garści", "kilku" ani niepotrzebnego przedziału. ' +
        'Gdy źródło jest nieprecyzyjne, dobierz jedną rozsądną wartość dla bazowej liczby porcji ' +
        'i zapisz ją metrycznie (np. sól 2 g, pieprz 0,5 g, oliwa 15 ml). ' +
        'JEDEN produkt = JEDEN składnik: rozbijaj zbitki ("Sól, pieprz i zioła" → trzy osobne składniki), ' +
        'inaczej dopasuje się tylko pierwszy człon. Przymiotniki zostaw tylko, gdy odróżniają produkt ' +
        '("Twaróg chudy" ≠ półtłusty — zostaw; "Dojrzałe awokado" → "Awokado"). ' +
        'Prawdziwe alternatywy zapisuj jako osobne składniki z tym samym alternativeGroup ' +
        '(Marchew lub Cukinia → dwa wiersze, oba alternativeGroup: "warzywo"); API odrzuca ' +
        'połączone name zawierające ukośnik, "lub" albo "albo".',
    ),
  steps: z.array(z.string()).describe(
    'Kroki przygotowania, po jednym zdaniu-akapicie. Każda obróbka ma liczbowy czas, temperaturę ' +
      'albo poziom ognia; nie używaj „kilka minut”, „do miękkości”, „aż zgęstnieje” ani „według ' +
      'instrukcji na opakowaniu” bez konkretu. Gdy wynik zależy od sprzętu, podaj czas i sprawdzalny ' +
      'punkt końcowy, np. „8 minut, do 74°C w środku”.',
  ),
}

server.tool(
  'get_cookbook',
  'Pobierz cookbook.md — profil kuchni (gospodarstwo, sprzęt, smaki, ankieta, zasady, stan spiżarni, lista przepisów). Czytaj przed proponowaniem posiłków.',
  {},
  async () => text((await get<{ markdown: string }>('/context/cookbook')).markdown),
)

server.tool(
  'search_recipes',
  'Szukaj zapisanych przepisów po tytule, źródle (np. „Blond Kuchara”, „Daily Dieta” — lista źródeł w cookbook.md), rodzaju dania, kuchni i/lub maksymalnym czasie.',
  {
    q: z.string().optional().describe('Fragment tytułu lub źródła'),
    source: z.enum(['ai', 'web', 'manual']).optional(),
    sourceName: z.string().optional().describe('Dokładne źródło przepisu, np. "Blond Kuchara" (wielkość liter bez znaczenia)'),
    dishType: z.enum(DISH_TYPES).optional().describe('Rodzaj dania'),
    cuisine: z.enum(CUISINES).optional().describe('Kuchnia/pochodzenie'),
    maxTime: z.number().int().positive().optional().describe('Maksymalny czas przygotowania w minutach'),
    airFryer: z.boolean().optional().describe('true = tylko dania z frytkownicy, false = tylko bez'),
  },
  async ({ q, source, sourceName, dishType, cuisine, maxTime, airFryer }) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (source) p.set('source', source)
    if (sourceName) p.set('sourceName', sourceName)
    if (dishType) p.set('dishType', dishType)
    if (cuisine) p.set('cuisine', cuisine)
    if (maxTime) p.set('maxTime', String(maxTime))
    if (airFryer !== undefined) p.set('airFryer', String(airFryer))
    const qs = p.toString()
    return text(await get(`/recipes${qs ? '?' + qs : ''}`))
  },
)

server.tool(
  'get_recipe',
  'Pobierz pełny przepis (składniki ze statusem jest/brak, kroki). Ilości składników są ' +
    'przeskalowane do zapisanego wyboru porcji (selectedServings, domyślnie 1); servings to bazowa liczba ' +
    'porcji. kcal/makro zawsze na jedną porcję. base=true zwraca ilości jak w przepisie — użyj przed update_recipe.',
  {
    id: z.string().uuid(),
    base: z.boolean().optional().describe('true = ilości bazowe (bez skalowania); zawsze przed update_recipe'),
  },
  async ({ id, base }) => text(await get(`/recipes/${id}${base ? '?base=true' : ''}`)),
)

server.tool(
  'set_recipe_nutrition',
  'Popraw tylko wartości odżywcze przepisu: kcal, protein, fat, carbs NA JEDNĄ PORCJĘ (komplet ' +
    'czterech) i opcjonalnie servings — na ile porcji wychodzą ilości z przepisu. Składniki, kroki i ' +
    'pozostałe pola zostają bez zmian — bezpieczniejsze niż update_recipe przy poprawianiu kalorii.',
  {
    id: z.string().uuid().describe('Id przepisu'),
    kcal: z.number().int().positive().describe('kcal na jedną porcję'),
    protein: z.number().min(0).describe('Białko w gramach na jedną porcję'),
    fat: z.number().min(0).describe('Tłuszcz w gramach na jedną porcję'),
    carbs: z.number().min(0).describe('Węglowodany w gramach na jedną porcję'),
    servings: z.number().int().min(1).max(200).optional().describe('Bazowa liczba porcji (tylko gdy obecna jest błędna)'),
  },
  async ({ id, ...input }) => text(await patch(`/recipes/${id}/nutrition`, input)),
)

server.tool(
  'set_recipe_servings',
  'Zapisz wybór liczby porcji dla przepisu (1–8, albo do bazowej liczby porcji, gdy większa). Skaluje ilości składników wszędzie, gdzie się ' +
    'liczą: szczegóły przepisu, do kupienia, cook-proposal i zapotrzebowanie na liście zakupów. ' +
    'Wartość 1 przywraca domyślną jedną porcję (jedna osoba).',
  {
    id: z.string().uuid().describe('Id przepisu'),
    servings: z.number().int().min(1).describe('Wybrana liczba porcji'),
  },
  async ({ id, servings }) => text(await put(`/recipes/${id}/servings`, { servings })),
)

server.tool(
  'add_recipe',
  'Zapisz nowy przepis w książce kucharskiej Pichci. Składniki są automatycznie łączone ze spiżarnią. Zdjęcie dania dołączysz potem przez add_recipe_image (zwrócone id).',
  recipeInputShape,
  async (input) => text(await post('/recipes', input)),
)

server.tool(
  'update_recipe',
  'Podmień istniejący przepis (pełna podmiana — podaj wszystkie pola i zachowaj tint z odczytu; składniki czytaj przez get_recipe z base=true, inaczej zapiszesz przeskalowane ilości; do samych kalorii użyj set_recipe_nutrition; pominięte dishType/cuisine/usesAirFryer/sourceName/kcal/protein/fat/carbs są czyszczone, więc przy edycji starszego przepisu uzupełnij je).',
  { id: z.string().uuid(), ...recipeInputShape },
  async ({ id, ...input }) => {
    await put(`/recipes/${id}`, input)
    return text({ ok: true, id })
  },
)

// Mirrors the backend whitelist (RecipeImageStore).
const IMAGE_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

server.tool(
  'add_recipe_image',
  'Dodaj zdjęcie dania do przepisu — z pliku lokalnego (filePath) LUB z internetu (url). ' +
    'JPG/PNG/WebP, maks. 5 MB. Nowe zdjęcie staje się domyślne; wcześniejsze zostają w galerii przepisu.',
  {
    id: z.string().uuid().describe('Id przepisu'),
    filePath: z.string().optional().describe('Ścieżka do pliku ze zdjęciem na dysku'),
    url: z.string().url().optional().describe('Adres URL zdjęcia do pobrania'),
  },
  async ({ id, filePath, url }) => {
    if (!filePath === !url) throw new Error('Podaj dokładnie jedno z: filePath albo url.')

    let bytes: Uint8Array<ArrayBuffer>
    let type: string | undefined
    let name: string
    if (filePath) {
      // Copy so the Blob sees a plain ArrayBuffer-backed view (Buffer may be pooled).
      bytes = new Uint8Array(await readFile(filePath))
      type = IMAGE_TYPE_BY_EXT[extname(filePath).toLowerCase()]
      name = filePath.replace(/^.*[\\/]/, '')
    } else {
      const res = await fetch(url!)
      if (!res.ok) throw new Error(`Nie udało się pobrać zdjęcia: ${res.status} ${res.statusText}`)
      bytes = new Uint8Array(await res.arrayBuffer())
      const pathname = new URL(url!).pathname
      type = res.headers.get('content-type')?.split(';')[0].trim()
      if (!type || !Object.values(IMAGE_TYPE_BY_EXT).includes(type))
        type = IMAGE_TYPE_BY_EXT[extname(pathname).toLowerCase()]
      name = pathname.replace(/^.*\//, '') || 'photo'
    }

    if (!type)
      throw new Error('Nieobsługiwany typ zdjęcia — dozwolone JPG, PNG i WebP.')
    if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_BYTES)
      throw new Error('Zdjęcie musi mieć od 1 B do 5 MB.')

    const form = new FormData()
    form.append('file', new Blob([bytes], { type }), name)
    return text(await post(`/recipes/${id}/image`, form))
  },
)

server.tool(
  'get_pantry',
  'Katalog spiżarni: quantity to przybliżony stan, planningQuantity to konserwatywna ilość do zakupów, ' +
    'confidence to confirmed/estimated/stale. 0 oznacza brak, pozycja zostaje w katalogu.',
  {},
  async () => text(await get('/pantry')),
)

server.tool(
  'add_to_pantry',
  'DODAJE ilości do spiżarni (delty) — używaj po paragonie / zakupach ("kupiłem 1000 ml mleka"). ' +
    'Wysyłaj surową nazwę z paragonu. Przy pierwszym rozstrzygnięciu podaj pantryItemId; aplikacja zapamięta ' +
    'mapowanie, opcjonalnie dla merchant. Pozycje spoza katalogu wracają w notInCatalog z kandydatami ' +
    'i NIE są zapisywane — wariant istniejącej pozycji → ponów z pantryItemId; nowy stały produkt → ' +
    'create_pantry_item; jednorazowy → pomiń.',
  {
    merchant: z.string().optional().describe('Sklep z paragonu, np. Lidl; ogranicza zapamiętane mapowanie'),
    items: z
      .array(
        z.object({
          name: z.string().describe('Surowa nazwa produktu z paragonu'),
          quantity: z.number().describe('Delta: ile doszło (ujemna = ubyło, np. coś się zepsuło)'),
          unit: z.string().optional().describe('g / ml / szt (też kg, dag, l — przeliczane)'),
          pantryItemId: z.string().uuid().optional().describe('Jawne rozstrzygnięcie do pozycji z get_pantry; zapisuje mapowanie'),
        }),
      )
      .min(1),
  },
  async ({ items, merchant }) => text(await post('/pantry/adjust', { items, merchant })),
)

server.tool(
  'get_receipt_mappings',
  'Pokaż zapamiętane mapowania surowych nazw z paragonów na kanoniczne produkty spiżarni.',
  {},
  async () => text(await get('/pantry/receipt-mappings')),
)

server.tool(
  'delete_receipt_mapping',
  'Usuń błędne zapamiętane mapowanie paragonowe (id z get_receipt_mappings).',
  { id: z.string().uuid() },
  async ({ id }) => {
    await del(`/pantry/receipt-mappings/${id}`)
    return text({ ok: true, removed: id })
  },
)

server.tool(
  'set_pantry_quantities',
  'USTAWIA absolutne ilości w spiżarni (inwentaryzacja — np. zdjęcie lodówki: "są 3 jajka"). ' +
    'Tylko istniejące pozycje katalogu (dopasowanie po nazwie/aliasach); nieznane wracają w notInCatalog. ' +
    'Do zakupów/paragonu używaj add_to_pantry (delty).',
  {
    items: z
      .array(
        z.object({
          name: z.string(),
          quantity: z.number().min(0).describe('Ile JEST (absolutnie), w jednostce pozycji'),
          unit: z.string().optional().describe('g / ml / szt (też kg, dag, l — przeliczane)'),
          category: z.enum(PANTRY_CATEGORIES).optional(),
          lowThreshold: z.number().positive().optional().describe('Próg "mało" w jednostce pozycji'),
        }),
      )
      .min(1),
  },
  async ({ items }) => text(await post('/pantry/bulk', { items })),
)

server.tool(
  'create_pantry_item',
  'Dodaj NOWĄ pozycję do katalogu spiżarni. Używaj oszczędnie — najpierw spróbuj dopasować przez ' +
    'add_to_pantry/set_pantry_quantities; wariant czegoś z katalogu dodaj jako alias (add_pantry_aliases), ' +
    'twórz tylko, gdy składnik naprawdę jest nowy w tej kuchni (np. pojawił się w nowym przepisie). ' +
    'Prosta polska nazwa bazowa, bez marek i opakowań ("Mleko", nie "Mleko Łaciate 3,2% 1L"); ' +
    'warianty podaj w aliases. Duplikat → błąd 409 z istniejącą pozycją.',
  {
    name: z.string(),
    category: z.enum(PANTRY_CATEGORIES),
    unit: z.enum(UNITS).describe('Kanoniczna jednostka pozycji — wszystkie ilości będą w niej'),
    quantity: z.number().min(0).optional().describe('Startowa ilość (domyślnie 0 = brak w domu)'),
    lowThreshold: z.number().positive().optional().describe('Próg "mało" (opcjonalny)'),
    aliases: z.array(z.string()).optional().describe('Alternatywne nazwy do dopasowywania, np. ["mleko 2%"]'),
  },
  async (input) => text(await post('/pantry', input)),
)

server.tool(
  'add_pantry_aliases',
  'Dodaj naturalne alternatywne nazwy używane w przepisach do istniejącej pozycji spiżarni, ' +
    'np. "bagietka" → Pieczywo. Surowych skrótów z paragonu tu nie dodawaj — add_to_pantry ' +
    'zapamiętuje je osobno po podaniu pantryItemId.',
  {
    name: z.string().describe('Nazwa istniejącej pozycji katalogu (np. "Pieczywo")'),
    aliases: z.array(z.string()).min(1).describe('Nowe aliasy, np. ["bułka kajzerka", "bagietka"]'),
  },
  async ({ name, aliases }) => {
    type Item = {
      id: string; name: string; category: string; unit: string
      quantity: number; lowThreshold: number | null; aliases: string[]
    }
    const groups = await get<{ items: Item[] }[]>('/pantry')
    const items = groups.flatMap((g) => g.items)
    const norm = (s: string) => s.trim().toLowerCase()
    const item = items.find((i) => norm(i.name) === norm(name))
    if (!item) throw new Error(`Nie ma pozycji "${name}" w katalogu — sprawdź get_pantry.`)
    const merged = [...item.aliases]
    for (const a of aliases) if (a.trim() && !merged.some((m) => norm(m) === norm(a))) merged.push(a.trim())
    return text(await put(`/pantry/${item.id}`, {
      name: item.name,
      category: item.category,
      unit: item.unit,
      lowThreshold: item.lowThreshold,
      aliases: merged,
    }))
  },
)

server.tool(
  'get_shopping_list',
  'Lista zakupów (z id pozycji do check_shopping_items / remove_shopping_items). ' +
    'Lista jest niezależna od spiżarni — nic nie pojawia się na niej automatycznie.',
  {},
  async () => text(await get('/shopping')),
)

server.tool(
  'add_shopping_items',
  'Dopisz pozycje do listy zakupów (opcjonalnie z ilością i powodem, np. reason: "Do: Carbonara").',
  {
    items: z
      .array(
        z.object({
          name: z.string(),
          category: z.string().optional(),
          quantity: z.number().positive().optional(),
          unit: z.enum(UNITS).optional(),
          reason: z.string().optional(),
        }),
      )
      .min(1),
  },
  async ({ items }) => {
    const results = []
    for (const item of items) results.push(await post('/shopping', item))
    return text(results)
  },
)

server.tool(
  'check_shopping_items',
  'Odhacz (lub odznacz) pozycje listy zakupów — np. kupione według paragonu. Id weź z get_shopping_list.',
  {
    ids: z.array(z.string().uuid()).min(1),
    checked: z.boolean().default(true).describe('true = odhaczone (kupione), false = cofnij'),
  },
  async ({ ids, checked }) => {
    const results = []
    for (const id of ids) results.push(await patch(`/shopping/${id}/check`, { checked }))
    return text(results)
  },
)

server.tool(
  'remove_shopping_items',
  'Usuń pozycje z listy zakupów (np. kupione albo już niepotrzebne). Id weź z get_shopping_list.',
  { ids: z.array(z.string().uuid()).min(1) },
  async ({ ids }) => {
    for (const id of ids) await del(`/shopping/${id}`)
    return text({ ok: true, removed: ids.length })
  },
)

server.tool(
  'clear_shopping_list',
  'Wyczyść CAŁĄ listę zakupów jednym ruchem (odhaczone i nieodhaczone). Nieodwracalne — ' +
    'do usunięcia tylko kupionych pozycji użyj remove_shopping_items albo check_shopping_items.',
  {},
  async () => text(await post('/shopping/clear', {})),
)

server.tool(
  'get_supplies',
  'Lista rzeczy do domu — chemia, higiena, papier, worki na śmieci (z id pozycji do ' +
    'check_supplies / remove_supplies). Osobna lista, niezależna od spiżarni I od listy ' +
    'zakupów spożywczych. Pole "hot" to rzeczy kupowane najczęściej — gotowy słownik do ' +
    'szybkiego dopisywania (pomija to, co już jest na liście).',
  {},
  async () => text(await get('/supplies')),
)

server.tool(
  'add_supplies',
  'Dopisz rzeczy do listy domowej (papier toaletowy, płyn do naczyń…). Same nazwy — bez ' +
    'ilości i jednostek. Kategoria opcjonalna: pominięta zostaje zgadnięta z nazwy. ' +
    'Bezpieczne przy powtórzeniu: to, co już jest na liście, nie zduplikuje się.',
  {
    items: z
      .array(
        z.object({
          name: z.string(),
          category: z.enum(SUPPLY_CATEGORIES).optional(),
        }),
      )
      .min(1),
  },
  async ({ items }) => {
    const results = []
    for (const item of items) results.push(await post('/supplies', item))
    return text(results)
  },
)

server.tool(
  'check_supplies',
  'Odhacz (lub odznacz) pozycje listy domowej. Id weź z get_supplies.',
  {
    ids: z.array(z.string().uuid()).min(1),
    checked: z.boolean().default(true).describe('true = odhaczone (kupione), false = cofnij'),
  },
  async ({ ids, checked }) => {
    const results = []
    for (const id of ids) results.push(await patch(`/supplies/${id}/check`, { checked }))
    return text(results)
  },
)

server.tool(
  'remove_supplies',
  'Usuń pozycje z listy domowej. Id weź z get_supplies. Statystyki „częstych" rzeczy ' +
    'zostają — to z nich liczy się ranking hot.',
  { ids: z.array(z.string().uuid()).min(1) },
  async ({ ids }) => {
    for (const id of ids) await del(`/supplies/${id}`)
    return text({ ok: true, removed: ids.length })
  },
)

server.tool(
  'clear_supplies',
  'Wyczyść CAŁĄ listę domową jednym ruchem (odhaczone i nieodhaczone). Nieodwracalne — ' +
    'do usunięcia tylko kupionych pozycji użyj remove_supplies albo check_supplies.',
  {},
  async () => text(await post('/supplies/clear', {})),
)

server.tool(
  'get_plan',
  'Kalendarz osoby: plan posiłków i dziennik jedzenia (domyślnie 14 dni od poniedziałku bieżącego ' +
    'tygodnia). Wpis ma eaten (zjedzone czy tylko w planie), kcal/protein/fat/carbs jako SUMY dla wpisu ' +
    '(nie na porcję), portions, slot (breakfast/lunch/dinner/snack), cookId/isLeftover dla garnków ' +
    'i isCatering dla cateringu. Kilka wpisów w jednym slocie to norma.',
  {
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
    days: z.number().int().positive().max(60).optional(),
  },
  async ({ start, days }) => {
    const p = new URLSearchParams()
    if (start) p.set('start', start)
    if (days) p.set('days', String(days))
    const qs = p.toString()
    return text(await get(`/plan${qs ? '?' + qs : ''}`))
  },
)

server.tool(
  'get_pending_cooks',
  'Zaległe posiłki: wpisy planu z przeszłości bez pasującego wpisu w historii gotowania ' +
    '(użytkownik mógł zapomnieć odnotować). Dopytaj: ugotowane → log_cook z cookedAt = data ' +
    'z planu; pominięte → dismiss_cook_reminder.',
  { days: z.number().int().positive().max(60).optional().describe('Ile dni wstecz (domyślnie 14)') },
  async ({ days }) => text(await get(`/plan/pending-cook${days ? `?days=${days}` : ''}`)),
)

server.tool(
  'dismiss_cook_reminder',
  'Oznacz zaległy wpis planu jako pominięty — zniknie z przypomnień (id z get_pending_cooks).',
  { id: z.string().uuid() },
  async ({ id }) => {
    await post(`/plan/entry/${id}/dismiss-cook-reminder`, {})
    return text({ ok: true, dismissed: id })
  },
)

server.tool(
  'set_plan_entry',
  'Zaplanuj posiłek na konkretny dzień i porę. Upsert: nadpisuje pierwszy zaplanowany (niezjedzony) ' +
    'posiłek w tym slocie; zjedzone wpisy, resztki i catering zostają. Podaj recipeId zapisanego przepisu ' +
    'ALBO title dla dania bez przepisu. Żeby DOPISAĆ kolejną rzecz do slotu albo zapisać coś zjedzonego, ' +
    'użyj log_food.',
  {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD'),
    slot: z.enum(['breakfast', 'lunch', 'dinner']).describe('śniadanie / obiad / kolacja'),
    recipeId: z.string().uuid().optional(),
    title: z.string().optional(),
    note: z.string().optional(),
  },
  async (input) => text(await put('/plan/entry', input)),
)

server.tool(
  'plan_cook_for_days',
  'Zaplanuj jeden garnek na kilka dni: dzień gotowania + resztki (każde przypisanie = 1 porcja). ' +
    'Zakupy liczą tylko dzień gotowania, przeskalowany do całego garnka. Używaj zamiast kilku set_plan_entry z tym samym przepisem.',
  {
    recipeId: z.string().uuid(),
    portions: z.number().int().min(1).max(12).describe('porcje w garnku (≥ 1 + liczba przypisań); nadwyżka czeka w lodówce (get_fridge)'),
    firstDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('dzień gotowania, YYYY-MM-DD'),
    firstSlot: z.enum(['breakfast', 'lunch', 'dinner']),
    assignments: z
      .array(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        slot: z.enum(['breakfast', 'lunch', 'dinner']),
      }))
      .optional()
      .describe('kolejne dni z resztkami'),
  },
  async (input) => text(await post('/diary/cooks', input)),
)

server.tool(
  'preview_plan_shopping',
  'Porównaj potrzeby planu z przybliżonym i konserwatywnym stanem spiżarni. ' +
    'needsConfirmation=true tylko wtedy, gdy szybka korekta może zmienić zakupy.',
  {
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
    days: z.number().int().positive().max(60).default(7),
  },
  async ({ start, days }) => {
    const p = new URLSearchParams()
    if (start) p.set('start', start)
    p.set('days', String(days))
    return text(await get(`/plan/shopping-preview?${p.toString()}`))
  },
)

server.tool(
  'add_plan_missing_to_shopping',
  'Jawnie dodaj brakujące składniki planu do niezależnej listy zakupów. Bez confirmations używa ' +
    'konserwatywnego stanu; podane korekty są atomowo potwierdzane przed przeliczeniem.',
  {
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
    days: z.number().int().positive().max(60).default(7),
    confirmations: z.array(z.object({
      pantryItemId: z.string().uuid(),
      quantity: z.number().min(0).describe('Przybliżona ilość faktycznie w domu'),
    })).optional(),
  },
  async (input) => text(await post('/plan/add-missing-to-shopping', input)),
)

server.tool(
  'log_cook',
  'Odnotuj ugotowane danie z oceną i notatką — to feedback, z którego uczą się kolejne propozycje. ' +
    'Podaj recipeId ALBO dishName. Przez deductions możesz od razu odjąć zużyte składniki ze spiżarni: ' +
    'ilości policz z przepisu (podpowiedź: get_cook_proposal), ilość w jednostce pozycji ' +
    'spiżarni, składniki o niezgodnej/nieprzeliczalnej jednostce pomiń. Stan nie zejdzie poniżej zera.',
  {
    recipeId: z.string().uuid().optional(),
    dishName: z.string().optional().describe('Nazwa dania, gdy nie ma zapisanego przepisu'),
    rating: z.number().int().min(1).max(5).optional(),
    note: z.string().optional().describe('np. "następnym razem mniej soli"'),
    cookedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD, domyślnie dziś'),
    deductions: z
      .array(
        z.object({
          pantryItemId: z.string().uuid().describe('Id pozycji spiżarni (z get_pantry lub cook-proposal)'),
          amount: z.number().positive().describe('Ile zeszło, w jednostce pozycji spiżarni'),
          unit: z.enum(UNITS).optional().describe('Kontrola zgodności z jednostką pozycji'),
        }),
      )
      .optional()
      .describe('Zużyte składniki do odjęcia ze spiżarni'),
  },
  async (input) => text(await post('/cooklog', input)),
)

server.tool(
  'update_cook_log_entry',
  'Popraw istniejący wpis historii gotowania (id z get_cook_log) — uzupełnij ocenę, ' +
    'notatkę, datę lub nazwę dania. rating/note są pełną podmianą (pominięte = wyczyszczone); ' +
    'dishName/cookedAt pominięte zostają bez zmian. Odjęć ze spiżarni nie da się edytować.',
  {
    id: z.string().uuid().describe('Id wpisu historii'),
    dishName: z.string().optional().describe('Nowa nazwa dania (tylko wpisy bez przepisu)'),
    rating: z.number().int().min(1).max(5).optional().describe('Ocena 1–5; pominięta = wyczyszczona'),
    note: z.string().optional().describe('Notatka; pominięta = wyczyszczona'),
    cookedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
  },
  async ({ id, ...input }) => text(await put(`/cooklog/${id}`, input)),
)

server.tool(
  'get_cook_log',
  'Historia gotowania (najnowsze pierwsze) z id wpisów do update_cook_log_entry. Opcjonalnie tylko jeden przepis.',
  {
    recipeId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(500).optional().describe('Domyślnie 50'),
  },
  async ({ recipeId, limit }) => {
    const p = new URLSearchParams()
    if (recipeId) p.set('recipeId', recipeId)
    if (limit) p.set('limit', String(limit))
    const qs = p.toString()
    return text(await get(`/cooklog${qs ? '?' + qs : ''}`))
  },
)

server.tool(
  'get_cook_proposal',
  'Co odjąć ze spiżarni po ugotowaniu przepisu (na składnik: pantryItemId, proposedAmount, deductible, ' +
    'skipReason) — gotowe deductions dla log_cook. Ilości są przeskalowane do zapisanego wyboru porcji.',
  { id: z.string().uuid().describe('Id przepisu') },
  async ({ id }) => text(await get(`/recipes/${id}/cook-proposal`)),
)

// ---- Dziennik jedzenia, cel i aktywność (prywatne, per osoba — MISE_PERSON) ----

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD')
const DIARY_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const

server.tool(
  'log_food',
  'Zapisz jedzenie w dzienniku (zawsze DOPISUJE nowy wpis — w slocie może być kilka). Domyślnie jako ' +
    'zjedzone (eaten=true); eaten=false = tylko zaplanowane. Zapisany przepis: recipeId + portions ' +
    '(kcal policzy aplikacja z przepisu). Wszystko inne: title + kcal i makro jako SUMY dla tego, co ' +
    'zjedzono (nie na 100 g — przelicz sam, gramy podaj w grams). Przekąski i słodycze → slot "snack". ' +
    'Szukając wartości odżywczych produktu, sprawdź najpierw get_food_favorites.',
  {
    date: DATE,
    slot: z.enum(DIARY_SLOTS).describe('śniadanie / obiad / kolacja / przekąski'),
    recipeId: z.string().uuid().optional().describe('Zapisany przepis'),
    portions: z.number().min(0.25).max(10).optional().describe('Porcje przepisu (domyślnie 1)'),
    title: z.string().optional().describe('Nazwa, gdy to nie zapisany przepis, np. "Kinder Bueno"'),
    grams: z.number().positive().optional().describe('Ile gramów zjedzono (informacyjnie)'),
    kcal: z.number().int().min(0).max(10000).optional().describe('Suma kcal wpisu (bez recipeId: zawsze podaj)'),
    protein: z.number().min(0).optional().describe('Suma białka w g'),
    fat: z.number().min(0).optional().describe('Suma tłuszczu w g'),
    carbs: z.number().min(0).optional().describe('Suma węglowodanów w g'),
    note: z.string().optional(),
    eaten: z.boolean().default(true).describe('true = zjedzone (domyślnie), false = tylko w planie'),
  },
  async (input) => text(await post('/plan/entries', input)),
)

server.tool(
  'update_plan_entry',
  'Zmień wpis kalendarza (id z get_plan): oznacz jako zjedzony (eaten=true zapisuje kcal przepisu na ' +
    'stałe) lub cofnij, przenieś (date/slot), zmień porcje (wpisy z przepisem) albo nazwę/kcal/makro ' +
    '(wpisy bez przepisu). Zmieniają się tylko podane pola.',
  {
    id: z.string().uuid(),
    eaten: z.boolean().optional(),
    date: DATE.optional(),
    slot: z.enum(DIARY_SLOTS).optional(),
    portions: z.number().min(0.25).max(10).optional().describe('Tylko wpisy z przepisem'),
    title: z.string().optional().describe('Tylko wpisy bez przepisu'),
    kcal: z.number().int().min(0).max(10000).optional().describe('Suma kcal; tylko wpisy bez przepisu'),
    protein: z.number().min(0).optional(),
    fat: z.number().min(0).optional(),
    carbs: z.number().min(0).optional(),
    grams: z.number().min(0).optional().describe('0 czyści'),
    note: z.string().optional(),
  },
  async ({ id, ...input }) => text(await patch(`/plan/entry/${id}`, input)),
)

server.tool(
  'delete_plan_entry',
  'Usuń wpis kalendarza (id z get_plan). Usunięcie dnia gotowania garnka usuwa też jego zaplanowane ' +
    'resztki (zjedzone zostają). Usunięty wpis cateringu nie wraca („dziś bez cateringu”).',
  { id: z.string().uuid() },
  async ({ id }) => {
    await del(`/plan/entry/${id}`)
    return text({ ok: true, removed: id })
  },
)

server.tool(
  'get_food_favorites',
  'Ulubione produkty z dziennika („Ulubione”): nazwa, kcal i makro na porcję albo na 100 g (per100g, ' +
    'lastGrams = zwykła ilość). Szybciej i dokładniej niż zgadywanie — użyj log_food_favorite.',
  {},
  async () => text(await get('/diary/favorites')),
)

server.tool(
  'log_food_favorite',
  'Zapisz ulubiony produkt jako zjedzony (id z get_food_favorites). Dla produktów na 100 g podaj grams ' +
    '(domyślnie zwykła ilość).',
  {
    id: z.string().uuid(),
    date: DATE,
    slot: z.enum(DIARY_SLOTS),
    grams: z.number().positive().optional(),
  },
  async ({ id, ...input }) => text(await post(`/diary/favorites/${id}/log`, input)),
)

server.tool(
  'get_fridge',
  '„W lodówce”: garnki z porcjami, które zostały (cookId, remaining, kcalPerPortion). Ugotowane ' +
    'jedzenie wypada stąd po 7 dniach.',
  {},
  async () => text(await get('/diary/fridge')),
)

server.tool(
  'eat_from_fridge',
  'Zjedz jedną porcję z garnka w lodówce (cookId z get_fridge) — zapisuje ją w dzienniku jako zjedzoną.',
  { cookId: z.string().uuid(), date: DATE, slot: z.enum(DIARY_SLOTS) },
  async ({ cookId, ...input }) => text(await post(`/diary/cooks/${cookId}/eat`, input)),
)

server.tool(
  'discard_fridge_leftovers',
  'Resztki z garnka wyrzucone — niezaplanowane porcje znikają z lodówki (cookId z get_fridge).',
  { cookId: z.string().uuid() },
  async ({ cookId }) => {
    await post(`/diary/cooks/${cookId}/discard`, {})
    return text({ ok: true, discarded: cookId })
  },
)

server.tool(
  'get_budget',
  'Dzienny budżet kcal: cel (target) + część kcal aktywnych z danego dnia (bonus) = budget, plus cel ' +
    'białka. Ile zostało = budget − suma kcal zjedzonych wpisów dnia (get_plan). target=null → cel ' +
    'jeszcze nieustawiony.',
  {
    start: DATE.optional().describe('Domyślnie poniedziałek bieżącego tygodnia'),
    days: z.number().int().min(1).max(60).optional().describe('Domyślnie 7'),
  },
  async ({ start, days }) => {
    const p = new URLSearchParams()
    if (start) p.set('start', start)
    if (days) p.set('days', String(days))
    const qs = p.toString()
    return text(await get(`/body/budget${qs ? '?' + qs : ''}`))
  },
)

server.tool(
  'get_progress',
  'Postępy: waga (trend = średnia 7 dni, weeklyChange), cel wagi, etaWeeks, bilans bieżącego tygodnia ' +
    '(średnio zjedzone vs budżet, deficyt) i seria dni z dziennikiem.',
  { days: z.number().int().min(7).max(730).optional().describe('Zakres wykresu wagi, domyślnie 84') },
  async ({ days }) => text(await get(`/body/progress${days ? `?days=${days}` : ''}`)),
)

server.tool(
  'get_goal',
  'Cel osoby („Twój cel”): płeć, wzrost, waga docelowa, tempo, poziom aktywności i wyliczone BMR, ' +
    'TDEE, dzienny cel kcal i białka. configured=false → jeszcze nieustawiony.',
  {},
  async () => text(await get('/body')),
)

server.tool(
  'log_weight',
  'Zapisz ważenie (kg) na dany dzień. Ręczny wpis wygrywa z wagą łazienkową; ponowny zapis nadpisuje.',
  { date: DATE, kg: z.number().min(25).max(350) },
  async ({ date, kg }) => text(await put(`/body/weights/${date}`, { kg })),
)

server.tool(
  'get_activity',
  'Aktywność z opaski i ręczne treningi z ostatnich dni (najnowsze pierwsze): kcal aktywne, bonus do ' +
    'budżetu, treningi. state: none/connected/stale (opaska nie wysyła danych od 24 h).',
  { days: z.number().int().min(1).max(60).optional().describe('Domyślnie 7') },
  async ({ days }) => text(await get(`/activity${days ? `?days=${days}` : ''}`)),
)

server.tool(
  'log_workout',
  'Dopisz ręczny trening (gdy opaska go nie złapała). Treningów z opaski nie dopisuj drugi raz — ' +
    'sprawdź najpierw get_activity.',
  {
    date: DATE,
    type: z.string().describe('Rodzaj, np. "Rower", "Siłownia"'),
    minutes: z.number().int().min(1).max(600),
    kcal: z.number().int().min(0).max(5000).describe('Spalone kcal aktywne (szacunek)'),
    time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Godzina startu HH:mm'),
  },
  async (input) => text(await post('/activity/workouts', input)),
)

// ---- Trening: katalog ćwiczeń (wspólny; free-exercise-db + polskie opisy) ----

const MUSCLES = [
  'abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings',
  'lats', 'lower-back', 'middle-back', 'neck', 'quadriceps', 'shoulders', 'traps', 'triceps',
] as const
const EQUIPMENT = [
  'body-only', 'dumbbell', 'kettlebell', 'bands', 'barbell', 'ez-bar', 'cable', 'machine',
  'medicine-ball', 'exercise-ball', 'foam-roll', 'other',
] as const
const EXERCISE_LEVELS = ['beginner', 'intermediate', 'expert'] as const
const EXERCISE_CATEGORIES = [
  'strength', 'stretching', 'plyometrics', 'cardio', 'powerlifting', 'olympic-weightlifting', 'strongman',
  'pilates', 'yoga', 'mobility',
] as const

type ExerciseRow = {
  id: string; name: string; nameEn: string; namePl: string | null; level: string; equipment: string
  primaryMuscles: string[]; secondaryMuscles: string[]; hasVideo: boolean; enriched: boolean; isTimed: boolean
}

const PL_LIST = z.array(z.string().max(600)).max(12)

const enrichShape = {
  namePl: z.string().max(200).optional().describe('Polska nazwa, jak mówi się na siłowni (np. "Wykroki z hantlami", "Hip thrust ze sztangą")'),
  instructionsPl: PL_LIST.optional().describe('Kroki wykonania po polsku, 3–6 krótkich zdań w trybie rozkazującym'),
  tipsPl: PL_LIST.optional().describe('„Na co uważać”: 2–4 wskazówki techniczne (np. "Kolano nad stopą, nie do środka")'),
  mistakesPl: PL_LIST.optional().describe('„Częste błędy”: 2–4 rzeczy, których NIE robić (np. "Odrywanie pięt od podłogi")'),
  youtubeId: z
    .string()
    .optional()
    .describe(
      'Film instruktażowy: id (11 znaków) albo link YouTube. Serwer sprawdza go w YouTube (oEmbed) — ' +
        'NIGDY nie zgaduj id; podaj tylko film, który znalazłeś w wyszukiwarce. "" usuwa film.',
    ),
  videoStartSeconds: z.number().int().min(0).max(14400).optional().describe('Od której sekundy zaczyna się pokaz ćwiczenia'),
  isTimed: z.boolean().optional().describe('true = wykonywane na czas (plank, rozciąganie), false = na powtórzenia'),
  hidden: z.boolean().optional().describe('Ukryj z katalogu (np. duplikat, ćwiczenie niszowe)'),
  level: z.enum(EXERCISE_LEVELS).optional(),
  primaryMuscles: z.array(z.enum(MUSCLES)).min(1).optional().describe('Popraw tylko, gdy dane źródłowe są błędne'),
  secondaryMuscles: z.array(z.enum(MUSCLES)).optional(),
}

server.tool(
  'search_exercises',
  'Szukaj w katalogu ćwiczeń (ok. 820 widocznych; nazwy angielskie, a po wzbogaceniu też polskie). Filtr ' +
    'muscle łapie partię główną LUB pomocniczą (główne pierwsze). location=home = sprzęt domowy (bez sprzętu, ' +
    'hantle, kettlebell, gumy, piłki, roller). enriched=false → ćwiczenia bez polskiego opisu (do /wzbogac-cwiczenia).',
  {
    q: z.string().optional().describe('Fraza z nazwy, PL lub EN (np. "lunge", "przysiad")'),
    muscle: z.enum(MUSCLES).optional(),
    equipment: z.array(z.enum(EQUIPMENT)).optional(),
    level: z.enum(EXERCISE_LEVELS).optional(),
    category: z.enum(EXERCISE_CATEGORIES).optional(),
    location: z.enum(['home', 'gym']).optional(),
    enriched: z.boolean().optional(),
    video: z.boolean().optional().describe('true = tylko z filmem, false = tylko bez filmu'),
    limit: z.number().int().min(1).max(200).optional().describe('Domyślnie 30'),
    offset: z.number().int().min(0).optional(),
  },
  async ({ equipment, limit, ...f }) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(f)) if (v !== undefined) p.set(k, String(v))
    if (equipment?.length) p.set('equipment', equipment.join(','))
    p.set('limit', String(limit ?? 30))
    const res = await get<{ total: number; enrichedTotal: number; catalogTotal: number; items: ExerciseRow[] }>(`/exercises?${p}`)
    return text({
      total: res.total,
      enrichedTotal: res.enrichedTotal,
      catalogTotal: res.catalogTotal,
      items: res.items.map((e) => ({
        id: e.id, name: e.name, nameEn: e.nameEn, level: e.level, equipment: e.equipment,
        primary: e.primaryMuscles, secondary: e.secondaryMuscles, timed: e.isTimed,
        video: e.hasVideo, enriched: e.enriched,
      })),
    })
  },
)

server.tool(
  'get_exercise',
  'Pełny opis ćwiczenia: instrukcje EN (instructionsEn) i PL, wskazówki, błędy, film, partie mięśni.',
  { id: z.string().uuid() },
  async ({ id }) => text(await get(`/exercises/${id}`)),
)

server.tool(
  'enrich_exercises',
  'Dopisz polskie opisy i filmy do ćwiczeń z katalogu (maks. 50 naraz). Podawaj tylko pola, które ' +
    'zmieniasz; listy podmieniają całość. Każde ćwiczenie zapisuje się osobno — błędy (np. nieistniejący ' +
    'film) wracają w errors z id, reszta się zapisuje. Napisz opis na podstawie instructionsEn (get_exercise) ' +
    'i własnej wiedzy trenerskiej, prostym językiem.',
  {
    items: z
      .array(z.object({ id: z.string().uuid(), ...enrichShape }))
      .min(1)
      .max(50),
  },
  async ({ items }) => text(await post('/exercises/enrich', { items })),
)

server.tool(
  'add_exercise',
  'Dodaj ćwiczenie, którego nie ma w katalogu (np. pilates, joga, mobilność). Najpierw sprawdź ' +
    'search_exercises (po PL i EN) — duplikat nazwy zwraca 409 z id istniejącego.',
  {
    namePl: z.string().max(200),
    nameEn: z.string().max(200).optional(),
    category: z.enum(EXERCISE_CATEGORIES).optional().describe('Domyślnie strength'),
    level: z.enum(EXERCISE_LEVELS).optional().describe('Domyślnie beginner'),
    equipment: z.enum(EQUIPMENT).optional().describe('Domyślnie body-only'),
    primaryMuscles: z.array(z.enum(MUSCLES)).min(1),
    secondaryMuscles: z.array(z.enum(MUSCLES)).optional(),
    instructionsPl: PL_LIST.optional(),
    tipsPl: PL_LIST.optional(),
    mistakesPl: PL_LIST.optional(),
    youtubeId: enrichShape.youtubeId,
    videoStartSeconds: enrichShape.videoStartSeconds,
    isTimed: z.boolean().optional(),
  },
  async (input) => text(await post('/exercises', input)),
)

server.tool(
  'get_exercise_alternatives',
  'Zamienniki ćwiczenia (ta sama partia główna): direction easier/similar/harder; location home = jej sprzęt ' +
    'z ankiety + masa ciała, none = bez sprzętu, gym = wszystko.',
  {
    id: z.string().uuid(),
    direction: z.enum(['easier', 'similar', 'harder']).optional(),
    location: z.enum(['home', 'gym', 'none']).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  },
  async ({ id, ...q }) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v))
    return text(await get(`/exercises/${id}/alternatives?${p}`))
  },
)

// ---- Trening: ankieta i plan (prywatne, per osoba) ----

const TRAINING_GOALS = ['lose-fat', 'tone', 'strength', 'mobility', 'general'] as const
const TRAINING_LOCATIONS = ['home', 'gym', 'any'] as const
const TRAINING_STYLES = ['strength', 'pilates', 'yoga', 'hiit', 'stretching', 'cardio'] as const

const programExerciseShape = z.object({
  exerciseId: z.string().uuid().describe('Id z search_exercises'),
  sets: z.number().int().min(1).max(10).optional().describe('Domyślnie 3'),
  repsMin: z.number().int().min(1).max(100).optional().describe('Zakres powtórzeń od…'),
  repsMax: z.number().int().min(1).max(100).optional().describe('…do (podwójna progresja: gdy zrobi górę zakresu, ciężar w górę)'),
  seconds: z.number().int().min(5).max(900).optional().describe('Zamiast powtórzeń — ćwiczenia na czas (plank, rozciąganie)'),
  restSeconds: z.number().int().min(0).max(600).optional().describe('Przerwa między seriami; domyślnie 75 s (na czas: 45 s)'),
  targetKg: z.number().min(0).max(500).optional().describe('Sugerowany ciężar (na rękę przy hantlach); pomiń przy masie ciała'),
  notes: z.string().max(300).optional().describe('Krótka wskazówka do tego planu, np. "tempo 3-1-1"'),
  supersetGroup: z.string().max(8).optional().describe('Ta sama litera = superseria'),
})

const programDayShape = z.object({
  week: z.number().int().min(1).max(26),
  weekday: z.number().int().min(0).max(6).describe('0 = poniedziałek … 6 = niedziela'),
  name: z.string().max(120).describe('Nazwa treningu, np. "Dół ciała A"; ta sama nazwa w kolejnych tygodniach = ten sam trening z progresją'),
  kind: z.enum(['exercises', 'follow-along']).optional().describe('exercises (domyślnie) albo follow-along = jeden pełny film do ćwiczenia razem'),
  location: z.enum(TRAINING_LOCATIONS).optional(),
  notes: z.string().max(1000).optional().describe('Rozgrzewka, wskazówki na ten dzień'),
  videoYoutubeId: z.string().optional().describe('follow-along: link/id filmu YouTube (sprawdzany — nie zgaduj)'),
  videoMinutes: z.number().int().min(1).max(240).optional(),
  workoutType: z.string().max(60).optional().describe('follow-along: etykieta do aktywności, np. "Pilates", "Joga", "HIIT"'),
  exercises: z.array(programExerciseShape).max(20).optional().describe('exercises: kolejność = kolejność wykonania'),
})

const programShape = {
  name: z.string().max(120),
  description: z.string().max(1000).optional(),
  rationale: z
    .string()
    .max(4000)
    .optional()
    .describe('Dlaczego taki plan — krótko, po polsku, dla niej (cel, podział, progresja, co z ankiety uwzględniono)'),
  startDate: DATE.optional().describe('Domyślnie najbliższy poniedziałek (dziś, jeśli poniedziałek)'),
  weeks: z.number().int().min(1).max(26).optional().describe('Domyślnie 4'),
  activate: z.boolean().optional().describe('true = ten plan staje się aktywny (poprzedni → archiwum)'),
  days: z.array(programDayShape).describe('Wszystkie dni wszystkich tygodni (rozpisz każdy tydzień — progresja jest w danych)'),
}

server.tool(
  'get_training_profile',
  'Ankieta treningowa osoby: cel, poziom, dni w tygodniu, minuty, preferowane dni (maska bitowa, bit 0 = pon), ' +
    'gdzie ćwiczy, sprzęt w domu, style, ograniczenia/kontuzje, czego nie lubi. configured=false → poproś o ankietę.',
  {},
  async () => text(await get('/training/profile')),
)

server.tool(
  'set_training_profile',
  'Zapisz ankietę treningową (podane pola; pominięte zostają).',
  {
    goal: z.enum(TRAINING_GOALS).optional(),
    level: z.enum(EXERCISE_LEVELS).optional(),
    daysPerWeek: z.number().int().min(1).max(7).optional(),
    minutesPerSession: z.number().int().min(10).max(180).optional(),
    preferredWeekdays: z.number().int().min(0).max(127).optional().describe('Maska: 1 = pon, 2 = wt, 4 = śr, 8 = czw, 16 = pt, 32 = sob, 64 = nd'),
    location: z.enum(TRAINING_LOCATIONS).optional(),
    homeEquipment: z.array(z.enum(EQUIPMENT)).optional(),
    styles: z.array(z.enum(TRAINING_STYLES)).optional(),
    limitations: z.string().max(1000).optional(),
    dislikes: z.string().max(1000).optional(),
    notes: z.string().max(1000).optional(),
  },
  async (input) => text(await put('/training/profile', input)),
)

server.tool(
  'get_training_program',
  'Plan treningowy: bez id = aktywny (pusty wynik = brak planu), z id = konkretny. Dni z datami, ćwiczenia ' +
    'z seriami/powtórzeniami/ciężarem. list=true → lista wszystkich planów osoby.',
  { id: z.string().uuid().optional(), list: z.boolean().optional() },
  async ({ id, list }) => {
    if (list) return text(await get('/training/programs'))
    const res = await get(id ? `/training/programs/${id}` : '/training/program')
    return text(res ?? { program: null, info: 'Brak aktywnego planu.' })
  },
)

server.tool(
  'create_training_program',
  'Utwórz plan treningowy z rozpisanymi WSZYSTKIMI tygodniami i dniami. Ćwiczenia tylko z katalogu (id z ' +
    'search_exercises), dobrane do ankiety (sprzęt, czas, ograniczenia). Serwer waliduje całość i zwraca błąd ' +
    'wskazujący dzień („Tydzień 2, wtorek: …”). Pokaż propozycję i zapisz po akceptacji.',
  programShape,
  async (input) => text(await post('/training/programs', { ...input, createdBy: 'ai' })),
)

server.tool(
  'replace_training_program',
  'Pełna podmiana planu (nagłówek + wszystkie dni) — do „dostosuj plan” na kolejne tygodnie. Przepisz też ' +
    'tygodnie, które się nie zmieniają.',
  { id: z.string().uuid(), ...programShape },
  async ({ id, ...input }) => text(await put(`/training/programs/${id}`, { ...input, createdBy: 'ai' })),
)

server.tool(
  'set_training_day',
  'Dodaj dzień do planu (bez dayId) albo podmień istniejący (z dayId: nazwa, termin, ćwiczenia — całość).',
  { programId: z.string().uuid(), dayId: z.string().uuid().optional(), day: programDayShape },
  async ({ programId, dayId, day }) =>
    text(dayId ? await put(`/training/programs/${programId}/days/${dayId}`, day) : await post(`/training/programs/${programId}/days`, day)),
)

server.tool(
  'delete_training_day',
  'Usuń dzień z planu (tylko na wyraźną prośbę).',
  { programId: z.string().uuid(), dayId: z.string().uuid() },
  async ({ programId, dayId }) => {
    await del(`/training/programs/${programId}/days/${dayId}`)
    return text({ ok: true })
  },
)

server.tool(
  'update_program_exercise',
  'Zmień jedno ćwiczenie w planie (id slotu z get_training_program): serie, powtórzenia, czas, przerwę, ciężar, ' +
    'notatkę — albo zamień ćwiczenie (exerciseId; zamienniki z get_exercise_alternatives). ' +
    'applyToFollowingWeeks=true zamienia je też w kolejnych tygodniach w dniach o tej samej nazwie.',
  {
    id: z.string().uuid(),
    exerciseId: z.string().uuid().optional(),
    sets: z.number().int().min(1).max(10).optional(),
    repsMin: z.number().int().min(1).max(100).optional(),
    repsMax: z.number().int().min(1).max(100).optional(),
    seconds: z.number().int().min(5).max(900).optional(),
    restSeconds: z.number().int().min(0).max(600).optional(),
    targetKg: z.number().min(0).max(500).optional(),
    clearTargetKg: z.boolean().optional(),
    notes: z.string().max(300).optional(),
    applyToFollowingWeeks: z.boolean().optional(),
  },
  async ({ id, ...input }) => text(await patch(`/training/program-exercises/${id}`, input)),
)

server.tool(
  'get_training_today',
  'Co dziś w planie: status none/before-start/scheduled/rest/finished, tydzień, dzisiejszy trening i następny.',
  { date: DATE.optional() },
  async ({ date }) => text(await get(`/training/today${date ? `?date=${date}` : ''}`)),
)

const transport = new StdioServerTransport()
await server.connect(transport)
