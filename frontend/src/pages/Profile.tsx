import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePreferences, useCookbook, useSavePreferences, useExportContext, useQuestionnaire } from '../api/hooks'
import type { Equipment, Preferences } from '../api/client'
import { ConnectAgentCard } from '../components/ConnectAgentCard'

const cardStyle: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 15,
  padding: '19px 21px',
}
const capStyle: CSSProperties = {
  font: "700 11px 'Hanken Grotesk'",
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 11,
}
const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  borderRadius: 9,
  padding: '8px 11px',
  font: "400 14px 'Hanken Grotesk'",
  color: 'var(--text)',
}

export function Profile() {
  const { data: prefs } = usePreferences()
  const { data: cookbook } = useCookbook()
  const save = useSavePreferences()
  const exportCtx = useExportContext()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  useEffect(() => {
    if (prefs && !editing) setDraft(prefs)
  }, [prefs, editing])

  if (!prefs || !draft) return <div style={{ padding: 40, color: 'var(--text-3)', maxWidth: 900, margin: '0 auto' }}>Ładowanie…</div>

  const view = editing ? draft : prefs

  function set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }

  async function onSave() {
    await save.mutateAsync(draft!)
    setEditing(false)
  }

  async function onSync() {
    const r = await exportCtx.mutateAsync()
    setSyncMsg(`Wyeksportowano ${r.files.length} plików do ${r.path}`)
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '38px 42px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ font: "600 11px 'Hanken Grotesk'", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
            Co wie asystent
          </div>
          <h1 style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 38, margin: '0 0 5px' }}>Profil kulinarny</h1>
        </div>
        {editing ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setEditing(false)} style={ghostBtn}>Anuluj</button>
            <button onClick={onSave} style={primaryBtn}>{save.isPending ? 'Zapisywanie…' : 'Zapisz'}</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} style={ghostBtn}>Edytuj profil</button>
        )}
      </div>
      <p style={{ fontSize: 14.5, color: 'var(--text-2)', margin: '0 0 28px', maxWidth: '60ch' }}>
        Te preferencje trafiają do pliku pamięci wysyłanego asystentowi na początku każdej rozmowy — żeby nigdy nie zaproponował
        czegoś, czego nie ugotujesz albo nie zjesz.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={capStyle}>Gospodarstwo</div>
          {editing ? (
            <>
              <input style={{ ...inputStyle, marginBottom: 8 }} value={view.householdSummary} onChange={(e) => set('householdSummary', e.target.value)} />
              <input style={inputStyle} value={view.householdDetail} onChange={(e) => set('householdDetail', e.target.value)} />
            </>
          ) : (
            <>
              <div style={{ fontFamily: "'Spectral', serif", fontSize: 22, fontWeight: 600, marginBottom: 3 }}>{view.householdSummary}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>{view.householdDetail}</div>
            </>
          )}
        </div>
        <div style={cardStyle}>
          <div style={capStyle}>Umiejętności i czas</div>
          {editing ? (
            <>
              <input style={{ ...inputStyle, marginBottom: 8 }} value={view.skillSummary} onChange={(e) => set('skillSummary', e.target.value)} />
              <input style={inputStyle} value={view.skillDetail} onChange={(e) => set('skillDetail', e.target.value)} />
            </>
          ) : (
            <>
              <div style={{ fontFamily: "'Spectral', serif", fontSize: 22, fontWeight: 600, marginBottom: 3 }}>{view.skillSummary}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>{view.skillDetail}</div>
            </>
          )}
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={capStyle}>Sprzęt</div>
        <EquipmentEditor editing={editing} value={view.equipment} onChange={(eq) => set('equipment', eq)} />
        {editing ? (
          <input style={{ ...inputStyle, marginTop: 11 }} value={view.equipmentNote} onChange={(e) => set('equipmentNote', e.target.value)} placeholder="Notatka o sprzęcie…" />
        ) : (
          view.equipmentNote && <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 11 }}>★ {view.equipmentNote}</div>
        )}
      </div>

      <QuestionnaireCard />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={capStyle}>Smaki i kuchnie</div>
          {editing ? (
            <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical', lineHeight: 1.5 }} value={view.tasteCuisines} onChange={(e) => set('tasteCuisines', e.target.value)} />
          ) : (
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-line' }}>{view.tasteCuisines}</div>
          )}
        </div>
        <div style={cardStyle}>
          <div style={capStyle}>Unikać / dieta</div>
          {editing ? (
            <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical', lineHeight: 1.5 }} value={view.avoidDietary} onChange={(e) => set('avoidDietary', e.target.value)} />
          ) : (
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-line' }}>{view.avoidDietary}</div>
          )}
        </div>
      </div>

      {/* plik pamięci cookbook.md */}
      <div style={{ background: '#2a221a', borderRadius: 15, overflow: 'hidden', border: '1px solid #3a2f24' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', borderBottom: '1px solid #3a2f24' }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--accent)' }} />
          <span style={{ font: "500 13px 'Spline Sans Mono'", color: '#e8dcc6' }}>cookbook.md</span>
          <span style={{ font: "400 11.5px 'Hanken Grotesk'", color: '#9a8c72' }}>— wysyłane do AI na początku każdej rozmowy</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onSync}
            style={{ font: "500 11px 'Hanken Grotesk'", color: '#b9aa8e', background: 'transparent', border: '1px solid #4a3d2e', borderRadius: 7, padding: '4px 9px', cursor: 'pointer' }}
          >
            {exportCtx.isPending ? 'Synchronizuję…' : 'Synchronizuj z ./context'}
          </button>
        </div>
        <pre style={{ margin: 0, padding: '18px 20px', fontFamily: "'Spline Sans Mono', monospace", fontSize: 12.5, lineHeight: 1.7, color: '#d8ccb4', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
          {cookbook?.markdown ?? 'Ładowanie…'}
        </pre>
        {syncMsg && <div style={{ padding: '0 20px 16px', font: "400 11.5px 'Spline Sans Mono'", color: '#9fb37a' }}>{syncMsg} — otwórz ten folder w Codex lub Claude Code.</div>}
      </div>

      <ConnectAgentCard />
    </div>
  )
}

function QuestionnaireCard() {
  const nav = useNavigate()
  const { data: q } = useQuestionnaire()
  if (!q) return null

  const total = q.sections.reduce((n, s) => n + s.questions.length, 0)
  const answeredKeys = new Set(Object.entries(q.answers).filter(([, v]) => v.trim().length > 0).map(([k]) => k))
  const highlights = q.sections
    .flatMap((s) => s.questions)
    .filter((question) => answeredKeys.has(question.key))
    .slice(0, 5)

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ ...capStyle, marginBottom: 0 }}>Ankieta kulinarna</div>
        <div style={{ flex: 1 }} />
        <button onClick={() => nav('/profile/ankieta')} style={answeredKeys.size === 0 ? primaryBtn : ghostBtn}>
          {answeredKeys.size === 0 ? 'Wypełnij ankietę' : 'Edytuj odpowiedzi'}
        </button>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '10px 0 0' }}>
        Odpowiedziano na {answeredKeys.size} z {total} pytań — im więcej, tym lepiej asystent zna Waszą kuchnię.
      </div>
      {highlights.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 12 }}>
          {highlights.map((question) => (
            <div key={question.key} style={{ fontSize: 13, lineHeight: 1.45 }}>
              <span style={{ color: 'var(--text-3)' }}>{question.label}: </span>
              <span style={{ color: 'var(--text)' }}>{q.answers[question.key]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EquipmentEditor({ editing, value, onChange }: { editing: boolean; value: Equipment[]; onChange: (e: Equipment[]) => void }) {
  const [name, setName] = useState('')

  function chipStyle(fav: boolean): CSSProperties {
    return {
      font: "500 13px 'Hanken Grotesk'",
      padding: '8px 13px',
      borderRadius: 9,
      background: fav ? 'rgba(189,139,44,.1)' : 'var(--surface)',
      border: '1px solid ' + (fav ? 'rgba(189,139,44,.4)' : 'var(--border)'),
      color: 'var(--text)',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      cursor: editing ? 'pointer' : 'default',
    }
  }

  return (
    <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'center' }}>
      {value.map((e, i) => (
        <span
          key={i}
          style={chipStyle(e.favorite)}
          onClick={() => editing && onChange(value.map((x, j) => (j === i ? { ...x, favorite: !x.favorite } : x)))}
          title={editing ? 'Kliknij, aby oznaczyć ulubiony' : undefined}
        >
          {e.favorite && <span style={{ color: 'var(--gold)' }}>★</span>}
          {e.name}
          {editing && (
            <span
              onClick={(ev) => {
                ev.stopPropagation()
                onChange(value.filter((_, j) => j !== i))
              }}
              style={{ color: 'var(--text-3)', marginLeft: 2 }}
            >
              ✕
            </span>
          )}
        </span>
      ))}
      {editing && (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              onChange([...value, { name: name.trim(), favorite: false }])
              setName('')
            }
          }}
          placeholder="+ dodaj sprzęt"
          style={{ border: '1px dashed var(--border-2)', background: 'transparent', borderRadius: 9, padding: '8px 11px', font: "400 13px 'Hanken Grotesk'", color: 'var(--text)', width: 150 }}
        />
      )}
    </div>
  )
}

const ghostBtn: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  borderRadius: 10,
  padding: '8px 14px',
  cursor: 'pointer',
  font: "500 13px 'Hanken Grotesk'",
}
const primaryBtn: CSSProperties = {
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: 10,
  padding: '8px 16px',
  cursor: 'pointer',
  font: "600 13px 'Hanken Grotesk'",
}
