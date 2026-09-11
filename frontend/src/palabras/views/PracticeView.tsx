import { SHOW_TRAPS } from '../config';
import { DECK_NAMES } from '../data/decks';
import { canSpeak, say } from '../lib/speech';
import { formatInterval, previewInterval } from '../lib/srs';
import type { Session } from '../state';
import type { Grade, SrsMap } from '../types';

interface Props {
  session: Session;
  srs: SrsMap;
  onReveal: () => void;
  onGrade: (grade: Grade) => void;
  onStartSession: () => void;
  onGoHome: () => void;
}

const GRADES: { grade: Grade; name: string; className: string }[] = [
  { grade: 0, name: 'Jeszcze raz', className: 'grade grade--again' },
  { grade: 1, name: 'Trudne', className: 'grade' },
  { grade: 2, name: 'Dobrze', className: 'grade' },
  { grade: 3, name: 'Łatwe', className: 'grade grade--easy' },
];

export function PracticeView({ session, srs, onReveal, onGrade, onStartSession, onGoHome }: Props) {
  const { queue, idx, revealed, done } = session;
  const card = queue[idx];
  const pct = queue.length ? Math.round((idx / queue.length) * 100) : 0;

  return (
    <div className="view view--practice">
      <div className="progress">
        <div className="progress__track">
          <div className="progress__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="progress__label">
          {Math.min(idx + 1, queue.length)} / {queue.length}
        </div>
      </div>

      {card && !done && (
        <>
          <div className="card">
            <div className="card__head">
              <div className="card__deck">{DECK_NAMES[card.deck] ?? 'Moje słowa'}</div>
              {canSpeak() && (
                <button type="button" className="speak" onClick={() => say(card.es)}>
                  <span className="speak__icon" aria-hidden="true">
                    ♪
                  </span>
                  <span>Posłuchaj</span>
                </button>
              )}
            </div>

            <div className="card__term">
              <h2 className="card__es">{card.es}</h2>
              {card.pos && <div className="card__pos">{card.pos}</div>}
            </div>

            {revealed && (
              <div className="reveal-block">
                <div className="chips">
                  <div className="chip-box chip-box--resp">
                    <div className="chip-box__label">Czytaj jak Polak</div>
                    <div className="chip-box__value">{card.resp}</div>
                  </div>
                  <div className="chip-box chip-box--ipa">
                    <div className="chip-box__label">IPA</div>
                    <div className="chip-box__value">{card.ipa}</div>
                  </div>
                </div>

                <div className="answer">
                  <div className="answer__pl">{card.pl}</div>

                  {card.ex && (
                    <div className="example">
                      <div className="example__es">{card.ex}</div>
                      {card.exPl && <div className="example__pl">{card.exPl}</div>}
                    </div>
                  )}

                  {SHOW_TRAPS && card.trap && (
                    <div className="trap">
                      <div className="trap__label">Uwaga</div>
                      <div className="trap__text">{card.trap}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {revealed ? (
            <div className="grades">
              {GRADES.map(({ grade, name, className }) => (
                <button key={grade} type="button" className={className} onClick={() => onGrade(grade)}>
                  <span className="grade__name">{name}</span>
                  <span className="grade__hint">
                    {grade === 0 ? 'za chwilę' : formatInterval(previewInterval(srs[card.id], grade))}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <button type="button" className="btn-reveal" onClick={onReveal}>
              Pokaż tłumaczenie
            </button>
          )}
        </>
      )}

      {done && (
        <div className="done">
          <h2 className="done__title">Sesja skończona</h2>
          <div className="done__text">
            {queue.length === 0
              ? 'Nic nie czeka na powtórkę w tym zestawie. Wybierz inny albo dodaj własne słowa.'
              : `${session.seen} powtórek, ${session.again} razy „jeszcze raz”. Wróć jutro — karty same się przypomną.`}
          </div>
          <div className="done__actions">
            <button type="button" className="btn-primary" onClick={onStartSession}>
              Jeszcze jedna sesja
            </button>
            <button type="button" className="btn-ghost" onClick={onGoHome}>
              Wróć do talii
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
