import type { ShoppingItem } from '../api/client'

export type ShoppingLayout = 'alphabetical' | 'lidl'

export interface ShoppingGroup {
  key: string
  label: string | null
  items: ShoppingItem[]
}

interface Aisle {
  key: string
  label: string
  categoryFallback?: string[]
}

const AISLES: Aisle[] = [
  { key: 'produce', label: 'Warzywa i owoce', categoryFallback: ['Produce'] },
  { key: 'bakery', label: 'Pieczywo' },
  { key: 'meat', label: 'Mięso i ryby' },
  { key: 'fridge', label: 'Nabiał i chłodnia', categoryFallback: ['Fridge'] },
  { key: 'dry', label: 'Produkty suche', categoryFallback: ['Pantry'] },
  { key: 'preserves', label: 'Konserwy, sosy i dodatki' },
  { key: 'spices', label: 'Przyprawy i wypieki', categoryFallback: ['Spices'] },
  { key: 'snacks', label: 'Przekąski i słodycze' },
  { key: 'drinks', label: 'Napoje' },
  { key: 'frozen', label: 'Mrożonki' },
  { key: 'home', label: 'Dom i higiena' },
  { key: 'other', label: 'Pozostałe' },
]

// Specific rules come first, so "chipsy paprykowe" do not land in produce.
const NAME_RULES: Array<[string, RegExp]> = [
  ['frozen', /\b(mroz|lody|sorbet)/],
  ['home', /\b(papier toalet|recznik papier|chustecz|detergent|proszek do prania|plyn do|tabletki do zmyw|worki na smieci|folia alumini|gabk|mydlo|szampon|pasta do zeb)/],
  ['snacks', /\b(chips|chrupk|paluszk|krakers|ciastk|baton|czekolad|cukierk|zelk|popcorn)/],
  ['drinks', /\b(woda|sok|napoj|cola|lemoniad|piwo|wino|kawa|herbat|mleko (kokos|owsian|soj|migdal|ryz))/],
  ['bakery', /\b(chleb|bulk|bulecz|bagiet|pieczyw|tortill|pita|croissant|kajzer|wafl)/],
  ['meat', /\b(kurcz|indyk|wolow|wieprz|mies|kielbas|szynk|boczek|salami|ryb|losos|dorsz|tunczyk|krewet|owoce morza)/],
  ['fridge', /\b(mleko|smietan|jogurt|kefir|maslo|ser|twarog|mozzarell|feta|parmezan|jaj|tofu|hummus)/],
  ['preserves', /\b(konserw|puszk|passat|przecier|sos|ketchup|majonez|musztard|oliw|olej|ocet|pesto|kapar|oliwk|ogorki konserw|bulion)/],
  ['spices', /\b(przypraw|pieprz|sol|papryka (slodk|ostra|wedzon)|curry|kurkum|cynamon|oregano|bazylia susz|tymianek|rozmaryn|kminek|kumin|wanili|proszek do pieczenia|drozdz|maka|cukier|kakao)/],
  ['dry', /\b(ryz|makaron|kasz|platk|musli|soczewic|ciecierzyc|fasol|groch|quinoa|kuskus|skrobi|bulka tarta)/],
  ['produce', /\b(pomidor|ogorek|papryk|marchew|ziemniak|cebul|czosnek|cukini|baklazan|brokul|kalafior|kapust|salat|szpinak|rukol|por|seler|pietrusz|koper|bazylia|kolendr|imbir|cytryn|limonk|jablk|gruszk|banan|pomarancz|mandarynk|winogron|truskawk|malin|borowk|awokado|pieczark|grzyb)/],
]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl-PL')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function aisleFor(item: ShoppingItem): Aisle {
  const name = normalize(item.name)
  const matchedKey = NAME_RULES.find(([, pattern]) => pattern.test(name))?.[0]
  if (matchedKey) return AISLES.find((aisle) => aisle.key === matchedKey)!

  return AISLES.find((aisle) => aisle.categoryFallback?.includes(item.category))
    ?? AISLES[AISLES.length - 1]
}

function byPolishName(a: ShoppingItem, b: ShoppingItem): number {
  return a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' })
}

export function alphabeticalShoppingGroups(items: ShoppingItem[]): ShoppingGroup[] {
  return [{
    key: 'all',
    label: null,
    items: [...items].sort((a, b) => Number(a.checked) - Number(b.checked) || byPolishName(a, b)),
  }]
}

export function lidlShoppingGroups(items: ShoppingItem[]): ShoppingGroup[] {
  const unchecked = items.filter((item) => !item.checked)
  const groups: ShoppingGroup[] = AISLES.map((aisle, index) => ({
    key: aisle.key,
    label: `${index + 1}. ${aisle.label}`,
    items: unchecked.filter((item) => aisleFor(item).key === aisle.key).sort(byPolishName),
  })).filter((group) => group.items.length > 0)

  const checked = items.filter((item) => item.checked).sort(byPolishName)
  if (checked.length > 0) groups.push({ key: 'checked', label: 'Odhaczone', items: checked })
  return groups
}

export function shoppingListAsText(items: ShoppingItem[], layout: ShoppingLayout): string {
  const unchecked = items.filter((item) => !item.checked)
  const groups = layout === 'lidl'
    ? lidlShoppingGroups(unchecked)
    : alphabeticalShoppingGroups(unchecked)

  return groups.map((group) => {
    const rows = group.items.map((item) => {
      const qty = item.quantity != null && item.unit
        ? ` — ${item.quantity.toLocaleString('pl-PL')} ${item.unit === 'szt' ? 'szt.' : item.unit}`
        : ''
      const reason = item.reason ? ` (${item.reason})` : ''
      return `• ${item.name}${qty}${reason}`
    })
    return group.label ? `${group.label}\n${rows.join('\n')}` : rows.join('\n')
  }).join('\n\n')
}
