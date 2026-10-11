import type { Ingredient } from '../api/client'

// "Potrzebne teraz" in cook mode: which ingredients does a step mention?
// Heuristic, not NLP — lowercase, strip Polish diacritics, then a word of the
// ingredient name matches when a step word starts with its stem (the word
// minus its last two letters, at least 4), which absorbs most inflection:
// "łosoś" ↔ "łososia", "cytryna" ↔ "cytryny", "czosnek" ↔ "czosnku".

const FOLD: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => FOLD[c])
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3)
}

// Descriptors that would match half the recipe ("świeży", "drobno"...).
const GENERIC = new Set([
  'swieze', 'swiezy', 'swieza', 'mielony', 'mielona', 'mielone', 'suszone', 'suszony', 'suszona',
  'drobno', 'posiekany', 'posiekana', 'duzy', 'duza', 'duze', 'maly', 'mala', 'male',
  'czerwona', 'czerwony', 'czerwone', 'biala', 'bialy', 'biale', 'zielona', 'zielony', 'zielone',
  'ekstra', 'naturalny', 'naturalna', 'jogurt', 'filety', 'filet', 'puszki', 'puszka', 'oliwy',
])

function stems(name: string): string[] {
  return words(name)
    .filter((w) => w.length >= 4 && !GENERIC.has(w))
    .map((w) => w.slice(0, Math.max(4, w.length - 2)))
}

/** Ingredients whose name appears (inflected) in the step text, in recipe order. */
export function ingredientsInStep(step: string, ingredients: Ingredient[]): Ingredient[] {
  const stepWords = words(step)
  return ingredients.filter((ing) => {
    const s = stems(ing.name)
    return s.length > 0 && s.some((stem) => stepWords.some((w) => w.startsWith(stem)))
  })
}

const ORDINALS = ['pierwszy', 'drugi', 'trzeci', 'czwarty', 'piąty', 'szósty', 'siódmy', 'ósmy', 'dziewiąty', 'dziesiąty']

/** "Krok drugi" for 1–10, "Krok 11" after that. */
export function stepTitle(index: number): string {
  return `Krok ${ORDINALS[index] ?? index + 1}`
}
