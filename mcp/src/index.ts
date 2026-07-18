#!/usr/bin/env node
// MCP server "mise" — first-class tools over the Mise cookbook REST API for
// Claude Code / Codex. The exported ./context folder stays the primary READ
// path; these tools are for writes and quick queries when the folder isn't open.
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { del, get, patch, post, put } from './api.js'

const server = new McpServer({ name: 'mise', version: '1.0.0' })

const text = (data: unknown) => ({
  content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
})

const DISH_TYPES = ['breakfast', 'main', 'soup', 'salad', 'side', 'dessert', 'snack', 'baking'] as const
const UNITS = ['g', 'ml', 'szt'] as const
const PANTRY_CATEGORIES = ['produce', 'fridge', 'pantry', 'spices'] as const
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
      'Szacunkowe kcal NA PORCJĘ — zawsze oszacuj (ze składników / liczby porcji). ' +
        'Zawsze komplet: kcal+protein+fat+carbs, nigdy samo kcal — gdy źródło podaje ' +
        'tylko kalorie, resztę policz ze składników',
    ),
  protein: z.number().positive().optional().describe('Białko w gramach NA PORCJĘ (szacunek) — zawsze oszacuj, razem z fat i carbs'),
  fat: z.number().positive().optional().describe('Tłuszcz w gramach NA PORCJĘ (szacunek) — zawsze oszacuj, razem z protein i carbs'),
  carbs: z.number().positive().optional().describe('Węglowodany w gramach NA PORCJĘ (szacunek) — zawsze oszacuj, razem z protein i fat'),
  blurb: z.string().optional().describe('Jedno-dwa zdania opisu'),
  tip: z.string().optional().describe('Wskazówka (opcjonalna)'),
  ingredients: z
    .array(
      z.object({
        name: z.string().describe('Kanoniczna nazwa produktu ze spiżarni, bez ilości i bez opisu przygotowania'),
        quantity: z.string().optional().describe('Sama ilość, pokazywana osobno po prawej, np. "100 g", "2 łyżki"'),
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
        'amountValue: 100, amountUnit: "g"); pomiń przy "garść", "do smaku" itp. ' +
        'JEDEN produkt = JEDEN składnik: rozbijaj zbitki ("Sól, pieprz i zioła" → trzy osobne składniki), ' +
        'inaczej dopasuje się tylko pierwszy człon. Przymiotniki zostaw tylko, gdy odróżniają produkt ' +
        '("Twaróg chudy" ≠ półtłusty — zostaw; "Dojrzałe awokado" → "Awokado"). ' +
        'Prawdziwe alternatywy zapisuj jako osobne składniki z tym samym alternativeGroup ' +
        '(Marchew lub Cukinia → dwa wiersze, oba alternativeGroup: "warzywo"); API odrzuca ' +
        'połączone name zawierające ukośnik, "lub" albo "albo".',
    ),
  steps: z.array(z.string()).describe('Kroki przygotowania, po jednym zdaniu-akapicie'),
}

server.tool(
  'get_cookbook',
  'Pobierz cookbook.md — profil kuchni (gospodarstwo, sprzęt, smaki, ankieta, zasady, stan spiżarni, lista przepisów). Czytaj przed proponowaniem posiłków.',
  {},
  async () => text((await get<{ markdown: string }>('/context/cookbook')).markdown),
)

server.tool(
  'search_recipes',
  'Szukaj zapisanych przepisów po tytule, źródle, rodzaju dania, kuchni i/lub maksymalnym czasie.',
  {
    q: z.string().optional().describe('Fragment tytułu'),
    source: z.enum(['ai', 'web', 'manual']).optional(),
    dishType: z.enum(DISH_TYPES).optional().describe('Rodzaj dania'),
    cuisine: z.enum(CUISINES).optional().describe('Kuchnia/pochodzenie'),
    maxTime: z.number().int().positive().optional().describe('Maksymalny czas przygotowania w minutach'),
    airFryer: z.boolean().optional().describe('true = tylko dania z frytkownicy, false = tylko bez'),
  },
  async ({ q, source, dishType, cuisine, maxTime, airFryer }) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (source) p.set('source', source)
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
    'przeskalowane do zapisanego wyboru porcji (selectedServings); servings to bazowa liczba porcji.',
  { id: z.string().uuid() },
  async ({ id }) => text(await get(`/recipes/${id}`)),
)

server.tool(
  'set_recipe_servings',
  'Zapisz wybór liczby porcji dla przepisu (1–8). Skaluje ilości składników wszędzie, gdzie się ' +
    'liczą: szczegóły przepisu, do kupienia, cook-proposal i zapotrzebowanie na liście zakupów. ' +
    'Wartość równa bazowej liczbie porcji przywraca przepis jak w oryginale.',
  {
    id: z.string().uuid().describe('Id przepisu'),
    servings: z.number().int().min(1).describe('Wybrana liczba porcji (1–8)'),
  },
  async ({ id, servings }) => text(await put(`/recipes/${id}/servings`, { servings })),
)

server.tool(
  'add_recipe',
  'Zapisz nowy przepis w książce kucharskiej Mise. Składniki są automatycznie łączone ze spiżarnią. Zdjęcie dania dołączysz potem przez add_recipe_image (zwrócone id).',
  recipeInputShape,
  async (input) => text(await post('/recipes', input)),
)

server.tool(
  'update_recipe',
  'Podmień istniejący przepis (pełna podmiana — podaj wszystkie pola i zachowaj tint z odczytu; pominięte dishType/cuisine/usesAirFryer/kcal/protein/fat/carbs są czyszczone, więc przy edycji starszego przepisu uzupełnij je).',
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
  'Katalog spiżarni pogrupowany po kategoriach: ilości liczbowe (quantity w jednostce unit: g/ml/szt; ' +
    '0 = brak w domu, pozycja zostaje w katalogu). Status (in/low/out) jest wyliczany z ilości.',
  {},
  async () => text(await get('/pantry')),
)

server.tool(
  'add_to_pantry',
  'DODAJE ilości do spiżarni (delty) — używaj po paragonie / zakupach ("kupiłem 1000 ml mleka"). ' +
    'Dopasowuje po nazwie z polską odmianą i aliasami; kg/dag/l są przeliczane na g/ml. ' +
    'Najpierw zmapuj produkty z paragonu na pozycje katalogu (get_pantry — nazwy i aliasy) i wysyłaj ' +
    'nazwy katalogowe ("BUŁKA KAJZERKA" → "Pieczywo"). Pozycje spoza katalogu wracają w notInCatalog ' +
    'i NIE są zapisywane — wariant istniejącej pozycji → add_pantry_aliases; nowy stały produkt → ' +
    'create_pantry_item; jednorazowy → pomiń.',
  {
    items: z
      .array(
        z.object({
          name: z.string().describe('Prosta polska nazwa bazowa, np. "Mleko"'),
          quantity: z.number().describe('Delta: ile doszło (ujemna = ubyło, np. coś się zepsuło)'),
          unit: z.string().optional().describe('g / ml / szt (też kg, dag, l — przeliczane)'),
        }),
      )
      .min(1),
  },
  async ({ items }) => text(await post('/pantry/adjust', { items })),
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
  'Naucz katalog nowego wariantu: dodaj aliasy (alternatywne nazwy) do istniejącej pozycji spiżarni, ' +
    'np. "bułka kajzerka" i "bagietka" → Pieczywo. Używaj, gdy add_to_pantry zwróci notInCatalog dla ' +
    'produktu, który JEST wariantem czegoś z katalogu — od tej pory będzie dopasowywany automatycznie.',
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
      quantity: item.quantity,
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
  'get_plan',
  'Plan posiłków (domyślnie 14 dni od poniedziałku bieżącego tygodnia).',
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
  'set_plan_entry',
  'Zaplanuj posiłek na konkretny dzień i porę (upsert — ponowny zapis nadpisuje). Podaj recipeId zapisanego przepisu ALBO title dla dania bez przepisu.',
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
  'log_cook',
  'Odnotuj ugotowane danie z oceną i notatką — to feedback, z którego uczą się kolejne propozycje. ' +
    'Podaj recipeId ALBO dishName. Przez deductions możesz od razu odjąć zużyte składniki ze spiżarni: ' +
    'ilości policz z przepisu (podpowiedź: GET /recipes/{id}/cook-proposal), ilość w jednostce pozycji ' +
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

const transport = new StdioServerTransport()
await server.connect(transport)
