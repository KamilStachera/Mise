import { DECKS } from '../data/decks';
import type { FormState } from '../state';
import type { Word } from '../types';

interface Props {
  form: FormState;
  saveMsg: string;
  saveError: boolean;
  custom: Word[];
  onSetField: (field: keyof FormState, value: string) => void;
  onSave: (form: FormState) => void;
  onRemove: (id: string) => void;
}

const TEXT_FIELDS: {
  field: keyof FormState;
  label: string;
  placeholder: string;
  className: string;
}[] = [
  { field: 'es', label: 'Po hiszpańsku', placeholder: 'la ventana', className: 'input input--serif' },
  { field: 'pl', label: 'Po polsku', placeholder: 'okno', className: 'input' },
  { field: 'resp', label: 'Wymowa po polsku', placeholder: 'la bentana', className: 'input' },
  { field: 'ipa', label: 'IPA (opcjonalnie)', placeholder: '/benˈta.na/', className: 'input' },
  {
    field: 'ex',
    label: 'Przykład (opcjonalnie)',
    placeholder: 'Abre la ventana.',
    className: 'input input--example',
  },
];

export function AddView({ form, saveMsg, saveError, custom, onSetField, onSave, onRemove }: Props) {
  return (
    <form
      className="view view--add"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
    >
      <div className="page-title-group">
        <h2 className="page-title">Dodaj słowo</h2>
        <div className="page-sub">
          Wystarczy hiszpański i polski. Resztę możesz uzupełnić później.
        </div>
      </div>

      <div className="form">
        {TEXT_FIELDS.map(({ field, label, placeholder, className }) => (
          <label className="field" key={field}>
            <span className="field__label">{label}</span>
            <input
              className={className}
              value={form[field]}
              placeholder={placeholder}
              onChange={(e) => onSetField(field, e.target.value)}
            />
          </label>
        ))}

        <label className="field">
          <span className="field__label">Zestaw</span>
          <select
            className="input"
            value={form.deck}
            onChange={(e) => onSetField('deck', e.target.value)}
          >
            {DECKS.map((deck) => (
              <option value={deck.id} key={deck.id}>
                {deck.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn-dark">
          Zapisz słowo
        </button>
        <div className={saveError ? 'save-msg save-msg--error' : 'save-msg'} role="status">
          {saveMsg}
        </div>
      </div>

      {custom.length > 0 && (
        <div className="group">
          <div className="section-label">Twoje słowa ({custom.length})</div>
          {custom.map((word) => (
            <div className="row" key={word.id}>
              <div className="row__text">
                <div className="row__es">{word.es}</div>
                <div className="row__sub">{word.pl}</div>
              </div>
              <button
                type="button"
                className="link-danger"
                aria-label={`Usuń ${word.es}`}
                onClick={() => onRemove(word.id)}
              >
                Usuń
              </button>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
