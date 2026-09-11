import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { SESSION_SIZE } from './config';
import { WORDS } from './data/words';
import { buildQueue, countWords } from './lib/srs';
import { save } from './lib/storage';
import { createInitialState, reducer, type FormState } from './state';
import type { DeckId, Grade, View, Word } from './types';

export function usePalabras() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);

  const allWords = useMemo<Word[]>(() => WORDS.concat(state.custom), [state.custom]);
  const counts = useMemo(() => countWords(allWords, state.srs), [allWords, state.srs]);

  useEffect(() => {
    save({ srs: state.srs, custom: state.custom });
  }, [state.srs, state.custom]);

  const startSession = useCallback(() => {
    const pool = state.deckId === 'all' ? allWords : allWords.filter((w) => w.deck === state.deckId);
    dispatch({ type: 'session/start', queue: buildQueue(pool, state.srs, SESSION_SIZE) });
  }, [allWords, state.deckId, state.srs]);

  const grade = useCallback((g: Grade) => {
    dispatch({ type: 'card/grade', grade: g, now: Date.now() });
  }, []);

  const reveal = useCallback(() => dispatch({ type: 'card/reveal' }), []);

  const go = useCallback(
    (view: View) => {
      if (view === 'practice') startSession();
      else dispatch({ type: 'view/go', view });
    },
    [startSession],
  );

  const addWord = useCallback((form: FormState) => {
    const es = form.es.trim();
    const pl = form.pl.trim();
    if (!es || !pl) {
      dispatch({ type: 'word/reject', message: 'Potrzebne są oba słowa.' });
      return;
    }
    dispatch({
      type: 'word/add',
      word: {
        id: `u${Date.now()}`,
        es,
        pl,
        pos: '',
        resp: form.resp.trim() || '—',
        ipa: form.ipa.trim() || '—',
        ex: form.ex.trim(),
        exPl: '',
        deck: form.deck,
        trap: '',
        custom: true,
      },
    });
  }, []);

  // Skróty klawiszowe sesji trzymamy tu, a nie w widoku: listener ma być jeden
  // niezależnie od tego, ile razy karta się przerysuje.
  const latest = useRef({ state, grade, reveal });
  latest.current = { state, grade, reveal };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { state: s, grade: g, reveal: r } = latest.current;
      if (s.view !== 'practice' || s.session.done) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (s.session.revealed) g(2);
        else r();
        return;
      }
      if (s.session.revealed && ['1', '2', '3', '4'].includes(e.key)) {
        g((Number(e.key) - 1) as Grade);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    state,
    allWords,
    counts,
    go,
    startSession,
    reveal,
    grade,
    addWord,
    pickDeck: useCallback((deckId: DeckId) => dispatch({ type: 'deck/toggle', deckId }), []),
    toggleResp: useCallback(() => dispatch({ type: 'sounds/toggleResp' }), []),
    setField: useCallback(
      (field: keyof FormState, value: string) => dispatch({ type: 'form/set', field, value }),
      [],
    ),
    removeWord: useCallback((id: string) => dispatch({ type: 'word/remove', id }), []),
    resetProgress: useCallback(() => dispatch({ type: 'progress/reset' }), []),
  };
}

export type Palabras = ReturnType<typeof usePalabras>;
