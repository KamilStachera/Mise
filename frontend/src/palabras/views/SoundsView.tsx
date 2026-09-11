import { SOUNDS } from '../data/sounds';
import { say } from '../lib/speech';

interface Props {
  hideResp: boolean;
  onToggleResp: () => void;
}

export function SoundsView({ hideResp, onToggleResp }: Props) {
  return (
    <div className="view view--sounds">
      <div className="page-head">
        <div className="page-title-group">
          <h2 className="page-title">Dźwięki hiszpańskiego</h2>
          <div className="page-sub">
            Litery czytane inaczej niż po polsku. Kliknij słowo, żeby je usłyszeć.
          </div>
        </div>
        <button type="button" className="pill pill--sm" onClick={onToggleResp}>
          {hideResp ? 'Pokaż wymowę' : 'Ukryj wymowę (tryb testu)'}
        </button>
      </div>

      {SOUNDS.map((group) => (
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
