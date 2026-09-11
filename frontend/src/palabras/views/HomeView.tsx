import { SESSION_SIZE } from '../config';
import { DECKS } from '../data/decks';
import { isKnown } from '../lib/srs';
import type { Counts, DeckId, SrsMap, Word } from '../types';

interface Props {
  counts: Counts;
  allWords: Word[];
  srs: SrsMap;
  deckId: DeckId | 'all';
  onPickDeck: (id: DeckId) => void;
  onStartSession: () => void;
  onGoAdd: () => void;
}

export function HomeView({ counts, allWords, srs, deckId, onPickDeck, onStartSession, onGoAdd }: Props) {
  const selectedDeck = deckId === 'all' ? null : DECKS.find((d) => d.id === deckId);
  const available = Math.min(SESSION_SIZE, counts.due + counts.fresh);
  const sessionLabel = `${selectedDeck ? `${selectedDeck.name} · ` : 'Wszystko · '}${available} kart`;

  return (
    <div className="view view--home">
      <div className="stat-grid">
        <div className="stat">
          <div className="stat__label">Do powtórki</div>
          <div className="stat__value stat__value--due">{counts.due}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Nowe</div>
          <div className="stat__value">{counts.fresh}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Umiem</div>
          <div className="stat__value stat__value--known">{counts.known}</div>
        </div>
      </div>

      <button type="button" className="cta" onClick={onStartSession}>
        <span>Zacznij sesję</span>
        <span className="cta__meta">{sessionLabel}</span>
      </button>

      <div className="group">
        <div className="section-label">Zestawy</div>
        {DECKS.map((deck) => {
          const words = allWords.filter((w) => w.deck === deck.id);
          const known = words.filter((w) => isKnown(srs[w.id])).length;
          const pct = words.length ? Math.round((known / words.length) * 100) : 0;
          const selected = deckId === deck.id;

          return (
            <button
              key={deck.id}
              type="button"
              className={selected ? 'deck is-selected' : 'deck'}
              aria-pressed={selected}
              onClick={() => onPickDeck(deck.id)}
            >
              <span className="deck__text">
                <span className="deck__name">{deck.name}</span>
                <span className="deck__sub">
                  {words.length} słów · {deck.sub}
                </span>
              </span>
              <span className="deck__meter">
                <span className="bar">
                  <span className="bar__fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="deck__pct">{pct}%</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="home-foot">
        <div className="home-foot__text">
          Sesja to {SESSION_SIZE} kart. Oceniasz się sam — odstępy powtórek dopasowują się do ocen.
        </div>
        <button type="button" className="pill" onClick={onGoAdd}>
          Dodaj własne słowo
        </button>
      </div>
    </div>
  );
}
