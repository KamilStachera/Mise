import type { SrsMap, Word } from '../types';

const KEY = 'palabras.v1';

export interface SavedState {
  srs: SrsMap;
  custom: Word[];
}

const EMPTY: SavedState = { srs: {}, custom: [] };

/**
 * Odczyt jest celowo pobłażliwy: prywatne okno, wyłączone dane witryny albo
 * ręcznie zepsuty wpis nie mogą wywrócić aplikacji — w najgorszym razie
 * zaczynamy od zera.
 */
export function load(): SavedState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    return {
      srs: parsed.srs ?? {},
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    };
  } catch {
    return EMPTY;
  }
}

export function save(state: SavedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* brak miejsca lub zablokowany storage — postęp zostaje tylko w pamięci */
  }
}
