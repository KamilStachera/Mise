import { useMemo, useState } from 'react';
import { SOUNDS } from '../data/sounds';
import { DECKS } from '../data/decks';
import { say } from '../lib/speech';
import { buildStreamPool } from '../lib/wordStream';
import type { Word } from '../types';
import { WordStream } from './WordStream';

interface Props {
  words: Word[];
  initialDeckId?: string;
  hideResp: boolean;
  onToggleResp: () => void;
}

export function SoundsView({ words, initialDeckId = 'all', hideResp, onToggleResp }: Props) {
  const [mode, setMode] = useState<'rules' | 'stream'>('rules');
  const [deckId, setDeckId] = useState(initialDeckId);
  const pool = useMemo(() => deckId === 'all' ? buildStreamPool(SOUNDS, words)
    : buildStreamPool([], words.filter((word) => word.deck === deckId)), [words, deckId]);
  return (
    <div className="view view--sounds">
      <div className="page-head">
        <div className="page-title-group">
          <h2 className="page-title">Dźwięki hiszpańskiego</h2>
          <div className="page-sub">
            Litery czytane inaczej niż po polsku. Poznaj zasady i ćwicz czytanie.
          </div>
        </div>
        {mode === 'rules' && <button type="button" className="pill pill--sm" onClick={onToggleResp}>
          {hideResp ? 'Pokaż wymowę' : 'Ukryj wymowę (tryb testu)'}
        </button>}
      </div>

      <div className="tabs" aria-label="Tryb dźwięków">
        <button type="button" className={`tab${mode === 'rules' ? ' is-active' : ''}`}
          aria-pressed={mode === 'rules'} onClick={() => setMode('rules')}>Zasady wymowy</button>
        <button type="button" className={`tab${mode === 'stream' ? ' is-active' : ''}`}
          aria-pressed={mode === 'stream'} onClick={() => setMode('stream')}>Strumień słów</button>
      </div>

      <details className="page-sub">
        <summary>Jak czytać zapis wymowy?</summary>
        <p>To przybliżenie zapisane polskimi literami. W nowych przykładach WIELKIE litery
          oznaczają akcentowaną sylabę, a łączniki rozdzielają sylaby. „S” przed „i”
          pozostaje twarde — nie czytaj go jak polskie „ś”.</p>
        <p>Stosujemy uproszczenia: ll i y ≈ j, b i v ≈ b. C przed e/i oraz z zapisujemy
          jako s; w większości Hiszpanii brzmią jak międzyzębowe „th”. Nagranie głosowe
          może więc różnić się od zapisu.</p>
      </details>

      {mode === 'stream' && <>
        <div className="field">
          <label className="field__label" htmlFor="sound-stream-deck">Zestaw słów</label>
          <select id="sound-stream-deck" className="input" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="all">Wszystkie słowa i dźwięki</option>
            {DECKS.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
          </select>
        </div>
        <WordStream key={deckId} pool={pool} />
      </>}
      {mode === 'rules' && SOUNDS.map((group) => (
        <div className="sound" key={group.g}>
          <div className="sound__head">
            <div className="sound__g">{group.g}</div>
            <div className="sound__rule">{group.rule}</div>
          </div>
          <div className="sound__words">
            {group.words.map((word) => (
              <button
                key={word.es}
                type="button"
                className="sound-word"
                onClick={() => say(word.es, 0.8)}
              >
                <span className="sound-word__es">{word.es}</span>
                {!hideResp && <span className="sound-word__resp">{word.resp}</span>}
                <span className="sound-word__pl">{word.pl}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
