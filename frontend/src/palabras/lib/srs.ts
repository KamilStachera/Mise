import type { CardState, Counts, Grade, SrsMap, Word } from '../types';

const DAY = 86_400_000;

/** Odstęp (w dniach), od którego uznajemy słowo za umiane. */
export const KNOWN_INTERVAL = 21;

const FRESH: Omit<CardState, 'due'> = { ease: 2.4, interval: 0, reps: 0, lapses: 0 };

function baseline(prev: CardState | undefined): Omit<CardState, 'due'> {
  return prev ? { ease: prev.ease, interval: prev.interval, reps: prev.reps, lapses: prev.lapses } : { ...FRESH };
}

/**
 * Oblicza odstęp po ocenie. Wydzielone z `applyGrade`, bo ten sam rachunek
 * napędza podpowiedzi "za ile dni" na przyciskach ocen — liczone przed oceną,
 * więc zawsze zgodne z tym, co faktycznie się stanie po kliknięciu.
 */
export function nextInterval(state: Omit<CardState, 'due'>, grade: Grade): number {
  const { ease, interval, reps } = state;
  switch (grade) {
    case 0:
      return 0;
    case 1:
      return reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
    case 2:
      return reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease);
    case 3:
      return reps === 0 ? 3 : Math.round(interval * ease * 1.25);
  }
}

/** Zwraca nowy stan karty po ocenie. Nie modyfikuje stanu wejściowego. */
export function applyGrade(prev: CardState | undefined, grade: Grade, now = Date.now()): CardState {
  const s = baseline(prev);
  const interval = nextInterval(s, grade);

  let { ease, reps, lapses } = s;
  if (grade === 0) {
    lapses += 1;
    reps = 0;
    ease = Math.max(1.6, ease - 0.2);
  } else {
    reps += 1;
    if (grade === 1) ease = Math.max(1.6, ease - 0.12);
    else if (grade === 3) ease = Math.min(3, ease + 0.1);
  }

  return { ease, interval, reps, lapses, due: now + interval * DAY };
}

/** Podgląd odstępu dla przycisku oceny — bez zmiany stanu. */
export function previewInterval(prev: CardState | undefined, grade: Grade): number {
  return nextInterval(baseline(prev), grade);
}

export function formatInterval(days: number): string {
  if (days < 1) return 'dziś';
  if (days === 1) return 'jutro';
  if (days < 30) return `za ${days} dni`;
  return `za ${Math.round(days / 30)} mies.`;
}

export function isKnown(state: CardState | undefined): boolean {
  return !!state && state.interval >= KNOWN_INTERVAL;
}

export function isDue(state: CardState | undefined, now = Date.now()): boolean {
  return !!state && state.due <= now;
}

export function countWords(words: Word[], srs: SrsMap, now = Date.now()): Counts {
  let due = 0;
  let fresh = 0;
  let known = 0;
  let learning = 0;

  for (const w of words) {
    const s = srs[w.id];
    if (!s) {
      fresh += 1;
      continue;
    }
    if (isKnown(s)) known += 1;
    else learning += 1;
    if (s.due <= now) due += 1;
  }

  return { due, fresh, known, learning, total: words.length };
}

function shuffle<T>(items: T[]): T[] {
  return items
    .map((v) => [Math.random(), v] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}

/**
 * Kolejka sesji: najpierw karty zaległe, potem nietknięte — obie grupy
 * przetasowane, całość przycięta do rozmiaru sesji.
 */
export function buildQueue(pool: Word[], srs: SrsMap, size: number, now = Date.now()): Word[] {
  const due = shuffle(pool.filter((w) => isDue(srs[w.id], now)));
  const fresh = shuffle(pool.filter((w) => !srs[w.id]));
  return due.concat(fresh).slice(0, size);
}
