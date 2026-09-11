import type { DeckId, Grade, SrsMap, View, Word } from './types';
import { applyGrade } from './lib/srs';
import { load } from './lib/storage';

export interface FormState {
  es: string;
  pl: string;
  resp: string;
  ipa: string;
  ex: string;
  deck: DeckId;
}

export interface Session {
  queue: Word[];
  idx: number;
  revealed: boolean;
  done: boolean;
  /** Ile ocen padło w tej sesji. */
  seen: number;
  /** Ile razy padło "jeszcze raz". */
  again: number;
}

export interface AppState {
  view: View;
  /** 'all' albo id talii — filtr materiału dla następnej sesji. */
  deckId: DeckId | 'all';
  /** Tryb testu: wymowa ukryta na ekranie dźwięków. */
  hideResp: boolean;
  srs: SrsMap;
  custom: Word[];
  session: Session;
  form: FormState;
  saveMsg: string;
  /** Czy `saveMsg` to odmowa zapisu, czy potwierdzenie. */
  saveError: boolean;
  /** Kasowanie postępu wymaga drugiego kliknięcia. */
  confirmReset: boolean;
}

const EMPTY_FORM: FormState = { es: '', pl: '', resp: '', ipa: '', ex: '', deck: 'moje' };

const EMPTY_SESSION: Session = { queue: [], idx: 0, revealed: false, done: false, seen: 0, again: 0 };

export function createInitialState(): AppState {
  const saved = load();
  return {
    view: 'home',
    deckId: 'all',
    hideResp: false,
    srs: saved.srs,
    custom: saved.custom,
    session: EMPTY_SESSION,
    form: EMPTY_FORM,
    saveMsg: '',
    saveError: false,
    confirmReset: false,
  };
}

export type Action =
  | { type: 'view/go'; view: View }
  | { type: 'deck/toggle'; deckId: DeckId }
  | { type: 'sounds/toggleResp' }
  | { type: 'session/start'; queue: Word[] }
  | { type: 'card/reveal' }
  | { type: 'card/grade'; grade: Grade; now: number }
  | { type: 'form/set'; field: keyof FormState; value: string }
  | { type: 'word/add'; word: Word }
  | { type: 'word/reject'; message: string }
  | { type: 'word/remove'; id: string }
  | { type: 'progress/reset' };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'view/go':
      return { ...state, view: action.view, confirmReset: false };

    case 'deck/toggle':
      // Kliknięcie w zaznaczoną talię zdejmuje filtr — z powrotem "wszystko".
      return { ...state, deckId: state.deckId === action.deckId ? 'all' : action.deckId };

    case 'sounds/toggleResp':
      return { ...state, hideResp: !state.hideResp };

    case 'session/start':
      return {
        ...state,
        view: 'practice',
        session: { ...EMPTY_SESSION, queue: action.queue, done: action.queue.length === 0 },
      };

    case 'card/reveal':
      return { ...state, session: { ...state.session, revealed: true } };

    case 'card/grade': {
      const { queue, idx } = state.session;
      const word = queue[idx];
      if (!word) return state;

      const srs = { ...state.srs, [word.id]: applyGrade(state.srs[word.id], action.grade, action.now) };
      // "Jeszcze raz" dokłada kartę na koniec kolejki — wróci w tej samej sesji.
      const nextQueue = action.grade === 0 ? [...queue, word] : queue;
      const nextIdx = idx + 1;

      return {
        ...state,
        srs,
        session: {
          queue: nextQueue,
          idx: nextIdx,
          revealed: false,
          done: nextIdx >= nextQueue.length,
          seen: state.session.seen + 1,
          again: state.session.again + (action.grade === 0 ? 1 : 0),
        },
      };
    }

    case 'form/set':
      return { ...state, form: { ...state.form, [action.field]: action.value }, saveMsg: '', saveError: false };

    case 'word/add':
      return {
        ...state,
        custom: [...state.custom, action.word],
        // Talia zostaje wybrana — kolejne słowo zwykle trafia tam samo.
        form: { ...EMPTY_FORM, deck: state.form.deck },
        saveMsg: `Zapisane: ${action.word.es}`,
        saveError: false,
      };

    case 'word/reject':
      return { ...state, saveMsg: action.message, saveError: true };

    case 'word/remove':
      return { ...state, custom: state.custom.filter((w) => w.id !== action.id) };

    case 'progress/reset':
      if (!state.confirmReset) return { ...state, confirmReset: true };
      return { ...state, srs: {}, confirmReset: false };
  }
}
