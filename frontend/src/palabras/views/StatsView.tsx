import { WORDS } from '../data/words';
import type { Counts, SrsMap, Word } from '../types';

interface Props {
  counts: Counts;
  allWords: Word[];
  srs: SrsMap;
  confirmReset: boolean;
  onReset: () => void;
}

const MAX_LEECHES = 5;
const MAX_TRAPS = 12;

const TRAPS = WORDS.filter((w) => w.trap).slice(0, MAX_TRAPS);

export function StatsView({ counts, allWords, srs, confirmReset, onReset }: Props) {
  const total = Math.max(1, counts.total);

  // Słowa, na których najczęściej się potykasz — kandydaci do osobnego powtarzania.
  const leeches = allWords
    .filter((w) => (srs[w.id]?.lapses ?? 0) > 0)
    .sort((a, b) => (srs[b.id]?.lapses ?? 0) - (srs[a.id]?.lapses ?? 0))
    .slice(0, MAX_LEECHES);

  return (
    <div className="view view--stats">
      <h2 className="page-title">Postęp</h2>

      <div className="panel">
        <div className="segbar">
          <div className="segbar__known" style={{ width: `${(counts.known / total) * 100}%` }} />
          <div className="segbar__learning" style={{ width: `${(counts.learning / total) * 100}%` }} />
        </div>
        <div className="legend">
          <div className="legend__item">
            <span className="dot dot--known" />
            <span>Umiem — {counts.known}</span>
          </div>
          <div className="legend__item">
            <span className="dot dot--learning" />
            <span>Uczę się — {counts.learning}</span>
          </div>
          <div className="legend__item">
            <span className="dot dot--fresh" />
            <span>Nietknięte — {counts.fresh}</span>
          </div>
        </div>
      </div>

      {leeches.length > 0 && (
        <div className="group">
          <div className="section-label">Najbardziej oporne</div>
          {leeches.map((word) => (
            <div className="row" key={word.id}>
              <div className="row__text">
                <div className="row__es">{word.es}</div>
                <div className="row__sub">
                  {word.pl} · {word.resp}
                </div>
              </div>
              <div className="row__lapses">{srs[word.id]?.lapses}× pomyłki</div>
            </div>
          ))}
        </div>
      )}

      <div className="group">
        <div className="section-label">Pułapki dla Polaka</div>
        {TRAPS.map((word) => (
          <div className="trap-row" key={word.id}>
            <div className="trap-row__es">{word.es}</div>
            <div className="trap-row__text">{word.trap}</div>
          </div>
        ))}
      </div>

      <button type="button" className="btn-reset" onClick={onReset}>
        {confirmReset ? 'Na pewno? Kliknij jeszcze raz' : 'Wyzeruj postęp'}
      </button>
    </div>
  );
}
