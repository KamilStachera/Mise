import type { SoundExample, SoundGroup, Word } from '../types';

export interface StreamWord extends SoundExample {
  rules: string[];
}

/** Sound examples take precedence, with all applicable rules kept for duplicates. */
export function buildStreamPool(groups: SoundGroup[], vocabulary: Word[]): StreamWord[] {
  const entries = new Map<string, StreamWord>();
  const key = (text: string) => text.trim().toLocaleLowerCase('es');
  for (const group of groups) {
    for (const word of group.words) {
      const existing = entries.get(key(word.es));
      const rule = `${group.g}: ${group.rule}`;
      if (existing) {
        if (!existing.rules.includes(rule)) existing.rules.push(rule);
      } else entries.set(key(word.es), { ...word, rules: [rule] });
    }
  }
  for (const word of vocabulary) {
    if (!word.es.trim() || !word.pl.trim()) continue;
    if (!entries.has(key(word.es)))
      entries.set(key(word.es), { es: word.es, pl: word.pl, resp: word.resp, rules: word.trap ? [word.trap] : [] });
  }
  return [...entries.values()];
}

export interface StreamState {
  words: StreamWord[];
  index: number;
  offset: number;
  remaining: StreamWord[];
}

const WINDOW_SIZE = 32;
const HISTORY_SIZE = 8;

function refill(state: StreamState, pool: StreamWord[], random: () => number): StreamState {
  const words = [...state.words];
  let remaining = [...state.remaining];
  while (words.length < WINDOW_SIZE && pool.length) {
    if (!remaining.length) {
      remaining = [...pool];
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      // Do not repeat the last word at the boundary between shuffled cycles.
      const last = remaining.length - 1;
      if (last > 0 && remaining[last].es === words[words.length - 1]?.es)
        [remaining[0], remaining[last]] = [remaining[last], remaining[0]];
    }
    words.push(remaining.pop()!);
  }
  return { ...state, words, remaining };
}

export function createStream(pool: StreamWord[], random = Math.random): StreamState {
  return refill({ words: [], index: 0, offset: 0, remaining: [] }, pool, random);
}

/** A bounded window and one shuffled bag allow indefinite practice without growing the DOM. */
export function selectStreamWord(state: StreamState, index: number, pool: StreamWord[], random = Math.random): StreamState {
  const selected = Math.max(0, Math.min(index, state.words.length - 1));
  const trim = Math.max(0, selected - HISTORY_SIZE);
  return refill({
    ...state, words: state.words.slice(trim), index: selected - trim, offset: state.offset + trim,
  }, pool, random);
}
