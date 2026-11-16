// Temporary Twilight quiz trainer (POP Quiz: Zmierzch, Mova Gdańsk, 28.11.2026).
// Self-contained: delete this folder + the /zmierzch line in App.tsx to remove it.

export const PARTS = ['zmierzch', 'ksiezyc', 'zacmienie', 'przed-switem', 'saga'] as const
export type Part = (typeof PARTS)[number]

export const SOURCES = ['film', 'ksiazka', 'oba'] as const
export type Source = (typeof SOURCES)[number]

export const CATEGORIES = ['fabula', 'postacie', 'cytaty', 'muzyka', 'obsada', 'kulisy', 'roznice', 'miejsca', 'liczby'] as const
export type Category = (typeof CATEGORIES)[number]

export type Difficulty = 1 | 2 | 3

export interface Question {
  /** Stable id — progress is keyed by it, never reuse one. */
  id: string
  part: Part
  source: Source
  category: Category
  difficulty: Difficulty
  q: string
  answer: string
  /** Three plausible but wrong options for the ABCD mode. */
  wrong: [string, string, string]
  /** Explanation / extra fact shown after answering. */
  note?: string
}

export const PART_LABEL: Record<Part, string> = {
  zmierzch: 'Zmierzch',
  ksiezyc: 'Księżyc w nowiu',
  zacmienie: 'Zaćmienie',
  'przed-switem': 'Przed świtem',
  saga: 'Cała saga',
}

export const SOURCE_LABEL: Record<Source, string> = {
  film: 'film',
  ksiazka: 'książka',
  oba: 'film i książka',
}

export const CATEGORY_LABEL: Record<Category, string> = {
  fabula: 'Fabuła',
  postacie: 'Postacie',
  cytaty: 'Cytaty',
  muzyka: 'Muzyka',
  obsada: 'Obsada',
  kulisy: 'Kulisy',
  roznice: 'Książka vs film',
  miejsca: 'Miejsca',
  liczby: 'Liczby i daty',
}
