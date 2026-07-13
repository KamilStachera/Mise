import type { Cuisine, DishType, Slot, Source, Status, Unit } from '../api/client'

// Polish display labels for English API tokens (enum values stay English on the wire).

export const sourceBadge: Record<Source, { label: string; col: string }> = {
  ai: { label: '✦ AI', col: 'var(--gold)' },
  web: { label: 'WWW', col: 'var(--sage)' },
  manual: { label: 'MOJE', col: 'var(--accent)' },
}

export const dishTypeLabel: Record<DishType, string> = {
  breakfast: 'Śniadanie',
  main: 'Danie główne',
  soup: 'Zupa',
  salad: 'Sałatka',
  side: 'Dodatek',
  dessert: 'Deser',
  snack: 'Przekąska',
  baking: 'Wypieki',
}

export const DISH_TYPES: DishType[] = ['breakfast', 'main', 'soup', 'salad', 'side', 'dessert', 'snack', 'baking']

export const cuisineLabel: Record<Cuisine, string> = {
  polish: 'polska',
  italian: 'włoska',
  french: 'francuska',
  spanish: 'hiszpańska',
  greek: 'grecka',
  mediterranean: 'śródziemnomorska',
  middleeastern: 'bliskowschodnia',
  indian: 'indyjska',
  thai: 'tajska',
  vietnamese: 'wietnamska',
  chinese: 'chińska',
  japanese: 'japońska',
  korean: 'koreańska',
  mexican: 'meksykańska',
  american: 'amerykańska',
  other: 'inna',
}

// Ordered by Polish label, "inna" last.
export const CUISINES: Cuisine[] = [
  ...(Object.keys(cuisineLabel) as Cuisine[])
    .filter((c) => c !== 'other')
    .sort((a, b) => cuisineLabel[a].localeCompare(cuisineLabel[b], 'pl')),
  'other',
]

export const DIFFICULTIES = ['Łatwe', 'Średnie', 'Trudne']

/** Polish plural: plural(3, 'wpis', 'wpisy', 'wpisów') → "3 wpisy". */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `1 ${one}`
  const last = n % 10
  const tens = n % 100
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

/** Polish plural: 1 przepis / 2 przepisy / 5 przepisów. */
export function recipeCountLabel(n: number): string {
  return plural(n, 'przepis', 'przepisy', 'przepisów')
}

export const statusLabel: Record<string, string> = {
  in: 'Jest',
  low: 'Mało',
  out: 'Brak',
  unknown: 'Brak',
}

export function statusColor(s: Status): string {
  return s === 'in' ? 'var(--sage)' : s === 'low' ? 'var(--gold)' : 'var(--accent)'
}

export const UNITS: Unit[] = ['g', 'ml', 'szt']

export const unitLabel: Record<Unit, string> = { g: 'g', ml: 'ml', szt: 'szt.' }

/** "350 g", "1,5 szt." — Polish decimal comma. */
export function formatQty(q: number, u: Unit): string {
  return `${q.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${unitLabel[u]}`
}

/** Grams with Polish decimal comma: "32 g", "17,5 g". */
export function formatGrams(g: number): string {
  return `${g.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} g`
}

/**
 * "~520 kcal · B 32 g · T 18 g · W 55 g" — per-serving macro summary
 * (mirrors CookbookMarkdownBuilder.MacroSummary); null when nothing estimated.
 */
export function macroSummary(r: { kcal: number | null; protein: number | null; fat: number | null; carbs: number | null }): string | null {
  const parts: string[] = []
  if (r.kcal != null) parts.push(`~${r.kcal} kcal`)
  if (r.protein != null) parts.push(`B ${formatGrams(r.protein)}`)
  if (r.fat != null) parts.push(`T ${formatGrams(r.fat)}`)
  if (r.carbs != null) parts.push(`W ${formatGrams(r.carbs)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

const CATEGORY_PL: Record<string, string> = {
  Produce: 'Warzywa i owoce',
  Fridge: 'Lodówka',
  Pantry: 'Spiżarnia',
  Spices: 'Przyprawy',
  Recipe: 'Przepis',
  Other: 'Inne',
}

export function categoryLabel(c: string): string {
  return CATEGORY_PL[c] ?? c
}

export const slotLabel: Record<Slot, string> = {
  breakfast: 'Śniadanie',
  lunch: 'Obiad',
  dinner: 'Kolacja',
}

export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner']

export const DAY_NAMES_PL = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela']
