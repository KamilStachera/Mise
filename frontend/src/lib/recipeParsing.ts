import type { ImportedRecipe, Unit } from '../api/client'

export interface RecipeFormIngredient {
  name: string
  quantity: string
  displayText: string
  alternativeGroup: string
  /** Preserved from backend ?base=true when quantity isn't edited, so structured amounts aren't lost on PUT. */
  amountValue?: number | null
  amountUnit?: Unit | null
  /** Snapshot of the quantity text loaded from the server; changing quantity clears preserved structured amounts. */
  originalQuantity?: string
}

const PL_FOLD: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
}

/** Lowercase + Polish diacritic folding ("Twaróg" → "twarog") for forgiving search. */
export function foldPolish(s: string | null | undefined): string {
  if (!s) return ''
  return s.toLocaleLowerCase('pl-PL').replace(/[ąćęłńóśźż]/g, (ch) => PL_FOLD[ch] ?? ch)
}

/** Normalize a single recipe tag: strip leading #, collapse spaces, lowercase pl-PL, max 40 chars. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pl-PL')
    .slice(0, 40)
    .trim()
}

/**
 * Multi-word AND search across title, sourceName, tags, and canonical ingredient names.
 * "twarog szpinak" matches a recipe whose ingredients include "Twaróg" and "Szpinak".
 */
export function matchesRecipeQuery(
  r: { title: string; sourceName?: string | null; tags?: string[]; ingredients?: string[] },
  query: string,
): boolean {
  const tokens = foldPolish(query)
    .split(/[\s,;]+/)
    .filter(Boolean)
  if (tokens.length === 0) return true
  const title = foldPolish(r.title)
  const source = foldPolish(r.sourceName)
  const tags = (r.tags ?? []).map(foldPolish)
  const ings = (r.ingredients ?? []).map(foldPolish)
  return tokens.every(
    (t) =>
      title.includes(t) ||
      source.includes(t) ||
      tags.some((tag) => tag.includes(t)) ||
      ings.some((ing) => ing.includes(t)),
  )
}

/** Parse a Polish/English numeric field (accepts comma or dot); returns null for blank/invalid. */
export function parseOptionalDecimal(raw: string): number | null {
  const clean = raw.trim().replace(',', '.')
  if (!clean) return null
  const n = Number(clean)
  return Number.isFinite(n) ? n : null
}

/** Parse a schema.org nutrition string ("420 kcal", "18,5 g") into a number, or null. */
export function parseNutritionNumber(raw: string | null | undefined): number | null {
  if (!raw) return null
  const m = raw.replace(',', '.').match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Parse a schema.org yield string ("4 porcje", "2-4 servings") into a reasonable base servings count. */
export function parseYieldServings(raw: string | null | undefined): number | null {
  if (!raw) return null
  const m = raw.match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isInteger(n) && n >= 1 && n <= 200 ? n : null
}

/** Friendly origin label for an imported recipe (author name, else hostname without www.). */
export function deriveImportSourceName(recipe: ImportedRecipe, url: string): string {
  const author = recipe.author?.trim()
  if (author && author.length <= 80) return author
  try {
    return new URL(url).hostname.replace(/^www\./i, '').slice(0, 80)
  } catch {
    return ''
  }
}

export function stripBullet(s: string): string {
  return s.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim()
}

export function parseIngredient(line: string): RecipeFormIngredient {
  const trimmed = line.trim()
  const m = trimmed.match(/^([\d¼½¾⅓⅔/.,–-]+\s*[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*\b)\s+(.{2,})$/)
  if (m && /\d/.test(m[1])) {
    return { name: m[2].trim(), quantity: m[1].trim(), displayText: trimmed, alternativeGroup: '' }
  }

  // Some Polish recipe sites render ingredients as "product – amount" rather than "amount product".
  const reversed = trimmed.match(/^(.{2,}?)\s+[–—-]\s+(.+)$/)
  if (reversed && /^(?:[\d¼½¾⅓⅔]|do smaku\b|według uznania\b|szczypta\b|garść\b)/i.test(reversed[2])) {
    return { name: reversed[1].trim(), quantity: reversed[2].trim(), displayText: trimmed, alternativeGroup: '' }
  }
  return { name: trimmed, quantity: '', displayText: trimmed, alternativeGroup: '' }
}

// Best-effort parse of pasted recipe text into structured fields (EN + PL headings).
export function parseRecipe(text: string): {
  title: string
  blurb: string
  ingredients: RecipeFormIngredient[]
  steps: string[]
} {
  const rawLines = text.split('\n').map((l) => l.trim())
  const lines = rawLines.filter((l) => l.length > 0)
  if (lines.length === 0) return { title: '', blurb: '', ingredients: [], steps: [] }

  const title = lines[0].replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim()

  const ingIdx = lines.findIndex((l) => /^#*\s*(ingredients|sk[łl]adniki)\b/i.test(l))
  const methodIdx = lines.findIndex((l) =>
    /^#*\s*(method|steps|instructions|directions|przygotowanie|spos[oó]b|wykonanie|kroki|instrukcje)\b/i.test(l),
  )

  const ingredients: RecipeFormIngredient[] = []
  const steps: string[] = []

  if (ingIdx >= 0) {
    const end = methodIdx > ingIdx ? methodIdx : lines.length
    for (let i = ingIdx + 1; i < end; i++) ingredients.push(parseIngredient(stripBullet(lines[i])))
  }
  if (methodIdx >= 0) {
    for (let i = methodIdx + 1; i < lines.length; i++) {
      const s = stripBullet(lines[i])
      if (s) steps.push(s)
    }
  }

  // Fallback: no headings — treat short lines as ingredients, long/numbered as steps.
  if (ingIdx < 0 && methodIdx < 0) {
    for (const l of lines.slice(1)) {
      if (/^\d+[.)]\s/.test(l)) steps.push(stripBullet(l))
      else if (l.length < 60) ingredients.push(parseIngredient(stripBullet(l)))
      else steps.push(l)
    }
  }

  const blurb = ingIdx > 1 ? lines.slice(1, ingIdx).join(' ') : ''
  return { title, blurb, ingredients: ingredients.filter((i) => i.name), steps }
}
