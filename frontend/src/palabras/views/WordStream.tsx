import { useEffect, useRef, useState } from 'react';
import { canSpeak, say } from '../lib/speech';
import { createStream, selectStreamWord, type StreamWord } from '../lib/wordStream';

const SETTINGS_KEY = 'palabras.stream.v1';
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { pronunciation: saved.pronunciation !== false, translation: saved.translation !== false };
  } catch { return { pronunciation: true, translation: true }; }
}

export function WordStream({ pool }: { pool: StreamWord[] }) {
  const [stream, setStream] = useState(() => createStream(pool));
  const [settings, setSettings] = useState(loadSettings);
  const [revealed, setRevealed] = useState(false);
  const text = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const current = stream.words[stream.index];
  const hasHints = settings.pronunciation || settings.translation;

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* optional preferences */ }
  }, [settings]);

  useEffect(() => {
    const container = text.current;
    const word = active.current;
    if (!container || !word) return;
    // Scroll only the text panel; never move the surrounding page away from its controls.
    const top = word.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop = Math.max(0, top - container.clientHeight / 2 + word.offsetHeight / 2);
  }, [stream]);

  useEffect(() => {
    // Revealing a longer answer must not push the next button below the phone navigation.
    controls.current?.scrollIntoView({ block: 'nearest' });
  }, [revealed, settings]);

  function select(index: number) {
    setStream(selectStreamWord(stream, index, pool));
    setRevealed(false);
  }

  return (
    <section className="word-stream" aria-label="Strumień słów">
      <div className="page-sub">
        Czytaj na głos wyróżnione słowo, odkryj podpowiedź i przejdź dalej.
        Po wykorzystaniu {pool.length} słów i zwrotów kolejność losuje się od nowa.
      </div>
      <fieldset className="word-stream__settings">
        <legend>Co pokazać po odkryciu?</legend>
        <label><input type="checkbox" checked={settings.pronunciation}
          onChange={(e) => setSettings({ ...settings, pronunciation: e.target.checked })} /> Wymowa po polsku</label>
        <label><input type="checkbox" checked={settings.translation}
          onChange={(e) => setSettings({ ...settings, translation: e.target.checked })} /> Tłumaczenie</label>
      </fieldset>
      <div ref={text} className="word-stream__text" aria-label="Tekst do czytania" lang="es">
        {stream.words.map((word, index) => (
          <button type="button" key={stream.offset + index}
            ref={index === stream.index ? active : undefined}
            className={`word-stream__word${index === stream.index ? ' is-current' : index < stream.index ? ' is-past' : ''}`}
            aria-current={index === stream.index ? 'true' : undefined}
            onClick={() => select(index)}>{word.es}</button>
        ))}
      </div>
      {current ? <>
        <div className="word-stream__answer" aria-live="polite" aria-atomic="true">
          <div className="word-stream__current"><span>Słowo {stream.offset + stream.index + 1}</span>
            <strong lang="es">{current.es}</strong>
            {canSpeak() && <button type="button" className="speak" onClick={() => say(current.es, 0.8)}>♪ Posłuchaj</button>}
          </div>
          {revealed && hasHints ? <div id="stream-hints">
            {settings.pronunciation && <div className="word-stream__hint">
              <span className="section-label">Czytaj jak Polak</span>
              <strong>{current.resp && current.resp !== '—' ? current.resp : 'Nie dodano wymowy tego słowa.'}</strong>
              {current.rules.map((rule) => <p className="word-stream__rule" key={rule}>{rule}</p>)}
            </div>}
            {settings.translation && <div className="word-stream__hint">
              <span className="section-label">Tłumaczenie</span><strong>{current.pl}</strong>
            </div>}
          </div> : <p className="word-stream__placeholder">
            {hasHints ? 'Najpierw spróbuj samodzielnie. Podpowiedź czeka pod przyciskiem.' : 'Czytasz bez podpowiedzi. Włącz wymowę lub tłumaczenie, żeby je odkrywać.'}
          </p>}
        </div>
        <div ref={controls} className="word-stream__actions">
          <button type="button" className="btn-ghost" disabled={stream.index === 0} onClick={() => select(stream.index - 1)}>← Wstecz</button>
          <button type="button" className="btn-primary" disabled={!hasHints}
            aria-expanded={revealed && hasHints} onClick={() => setRevealed(!revealed)}>
            {revealed ? 'Ukryj podpowiedź' : 'Pokaż podpowiedź'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => select(stream.index + 1)}>Następne →</button>
        </div>
      </> : <p>Dodaj słowa, żeby rozpocząć czytanie.</p>}
    </section>
  );
}
