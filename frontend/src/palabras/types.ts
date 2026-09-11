export type DeckId = string;

export interface Deck {
  id: DeckId;
  name: string;
  sub: string;
}

export interface Word {
  id: string;
  es: string;
  pl: string;
  /** Część mowy — "rzeczownik", "czasownik", "zwrot"… */
  pos: string;
  /** Wymowa zapisana polską ortografią. */
  resp: string;
  ipa: string;
  ex: string;
  exPl: string;
  deck: DeckId;
  /** Pułapka dla Polaka — pusty string, jeśli słowo żadnej nie ma. */
  trap: string;
  /** Oznacza słowo dodane przez użytkownika, nie pochodzące z talii wbudowanej. */
  custom?: boolean;
}

export interface SoundExample {
  es: string;
  resp: string;
  pl: string;
}

export interface SoundGroup {
  /** Litera lub dwuznak, np. "LL", "GUE / GUI". */
  g: string;
  rule: string;
  words: SoundExample[];
}

/** Stan powtórek jednej karty. */
export interface CardState {
  ease: number;
  /** Odstęp do następnej powtórki, w dniach. */
  interval: number;
  reps: number;
  lapses: number;
  /** Timestamp (ms) następnej powtórki. */
  due: number;
}

export type SrsMap = Record<string, CardState>;

/** 0 = jeszcze raz, 1 = trudne, 2 = dobrze, 3 = łatwe. */
export type Grade = 0 | 1 | 2 | 3;

export type View = 'home' | 'practice' | 'sounds' | 'add' | 'stats';

export interface Counts {
  due: number;
  fresh: number;
  known: number;
  learning: number;
  total: number;
}
