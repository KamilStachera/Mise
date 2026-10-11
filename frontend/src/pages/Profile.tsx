import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useLogout, usePreferences, useCookbook, useSavePreferences, useExportContext, useQuestionnaire, useCookLog } from '../api/hooks'
import { loginUrl, type Equipment, type Preferences, type Questionnaire } from '../api/client'
import { ConnectAgentCard } from '../components/ConnectAgentCard'
import { useIsMobile } from '../lib/useIsMobile'
import { Avatar, Button, Chip, Eyebrow, PageTitle, SectionHead, inputStyle, mono, sans, usePagePad } from '../components/ui'

/** The profile ("Profil kulinarny" on desktop, the "Ja" tab on phones). */
export function Profile() {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { data: auth, canEdit } = useAuth()
  const logout = useLogout()
  const { data: prefs } = usePreferences()
  const { data: questionnaire } = useQuestionnaire()
  const { data: cookLog } = useCookLog(undefined, 500)
  const save = useSavePreferences()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Preferences | null>(null)

  useEffect(() => {
    if (prefs && !editing) setDraft(prefs)
  }, [prefs, editing])

  if (!prefs || !draft) return <div style={{ ...pad, color: 'var(--text-3)' }}>Ładowanie…</div>

  const view = editing ? draft : prefs
  function set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }
  async function onSave() {
    await save.mutateAsync(draft!)
    setEditing(false)
  }

  const answered = questionnaire ? Object.values(questionnaire.answers).filter((v) => v.trim()).length : 0
  const totalQuestions = questionnaire ? questionnaire.sections.reduce((n, s) => n + s.questions.length, 0) : 0

  const editControls = canEdit && (editing ? (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="quiet" size={isMobile ? 'sm' : 'md'} onClick={() => setEditing(false)}>Anuluj</Button>
      <Button size={isMobile ? 'sm' : 'md'} onClick={onSave} disabled={save.isPending}>{save.isPending ? 'Zapisywanie…' : 'Zapisz'}</Button>
    </div>
  ) : (
    <Button variant="outline" size={isMobile ? 'sm' : 'md'} onClick={() => setEditing(true)}>{isMobile ? 'Edytuj' : 'Edytuj profil'}</Button>
  ))

  const household = (
    <Fact
      label="Gospodarstwo"
      editing={editing}
      summary={view.householdSummary}
      detail={view.householdDetail}
      onSummary={(v) => set('householdSummary', v)}
      onDetail={(v) => set('householdDetail', v)}
    />
  )
  const skills = (
    <Fact
      label="Umiejętności i czas"
      editing={editing}
      summary={view.skillSummary}
      detail={view.skillDetail}
      onSummary={(v) => set('skillSummary', v)}
      onDetail={(v) => set('skillDetail', v)}
    />
  )
  const equipment = (
    <Block label="Sprzęt">
      <EquipmentEditor editing={editing} value={view.equipment} onChange={(eq) => set('equipment', eq)} />
      {editing ? (
        <input style={inputStyle} value={view.equipmentNote} onChange={(e) => set('equipmentNote', e.target.value)} placeholder="Notatka o sprzęcie…" />
      ) : (
        view.equipmentNote && <span style={{ font: sans(13.5), lineHeight: 1.45, color: 'var(--text-2)' }}>★ {view.equipmentNote}</span>
      )}
    </Block>
  )
  const tastes = (
    <TextBlock label="Smaki i kuchnie" editing={editing} value={view.tasteCuisines} onChange={(v) => set('tasteCuisines', v)} />
  )
  const avoid = (
    <TextBlock label="Unikać / dieta" editing={editing} value={view.avoidDietary} onChange={(v) => set('avoidDietary', v)} />
  )

  if (isMobile) {
    return (
      <div style={{ ...pad, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar name={auth?.name ?? auth?.email} picture={auth?.picture} size={56} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 30, lineHeight: 1, letterSpacing: '-0.02em' }}>Twoja kuchnia</h1>
            <span style={{ font: sans(13.5), color: 'var(--text-2)' }}>{[prefs.householdSummary, prefs.skillSummary].filter(Boolean).join(' · ')}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--rule)' }}>
          <LinkRow label="Historia gotowania" meta={cookLog ? String(cookLog.length) : ''} onClick={() => nav('/history')} />
          <LinkRow label="Ankieta kulinarna" meta={totalQuestions ? `${answered}/${totalQuestions}` : ''} onClick={() => nav('/profile/ankieta')} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>
            <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 20 }}>Co wie asystent</span>
            {editControls}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: editing ? '1fr' : '1fr 1fr', gap: 16 }}>
            {household}
            {skills}
          </div>
          {equipment}
          {tastes}
          {avoid}
        </div>

        <Collapsible title="cookbook.md — plik pamięci">
          <CookbookPanel canEdit={canEdit} />
        </Collapsible>
        {canEdit && (
          <Collapsible title="Połącz agenta (Codex / Claude Code)">
            <ConnectAgentCard />
          </Collapsible>
        )}

        {canEdit ? (
          <Button variant="text" style={{ alignSelf: 'flex-start', font: sans(14, 600) }} onClick={() => logout.mutate()}>Wyloguj</Button>
        ) : (
          <Button variant="outline" onClick={() => { window.location.href = loginUrl('/profile') }}>Zaloguj przez Google</Button>
        )}
      </div>
    )
  }

  return (
    <div style={{ ...pad, maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
      <PageTitle
        title="Profil kulinarny"
        sub="Te preferencje trafiają do pliku pamięci wysyłanego asystentowi na początku każdej rozmowy — żeby nigdy nie zaproponował czegoś, czego nie ugotujesz albo nie zjesz."
        right={canEdit ? editControls : <Button onClick={() => { window.location.href = loginUrl('/profile') }}>Zaloguj przez Google</Button>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr)', gap: 56, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {household}
          {skills}
          {equipment}
        </div>
        {questionnaire && <QuestionnaireSummary q={questionnaire} answered={answered} total={totalQuestions} canEdit={canEdit} />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 8 }}>
        <SectionHead title="Asystent i dane" size={24} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 56 }}>
          {tastes}
          {avoid}
        </div>
        <CookbookPanel canEdit={canEdit} />
        {canEdit && <ConnectAgentCard />}
      </div>
    </div>
  )
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </div>
  )
}

function Fact({ label, editing, summary, detail, onSummary, onDetail }: {
  label: string
  editing: boolean
  summary: string
  detail: string
  onSummary: (v: string) => void
  onDetail: (v: string) => void
}) {
  const isMobile = useIsMobile()
  if (editing)
    return (
      <Block label={label}>
        <input style={inputStyle} value={summary} onChange={(e) => onSummary(e.target.value)} />
        <input style={inputStyle} value={detail} onChange={(e) => onDetail(e.target.value)} />
      </Block>
    )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 4 : 6, borderTop: isMobile ? 0 : '1px solid var(--rule)', paddingTop: isMobile ? 0 : 14, minWidth: 0 }}>
      <Eyebrow size={isMobile ? 10.5 : 11}>{label}</Eyebrow>
      <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 20 : 30, lineHeight: 1.1 }}>{summary || '—'}</span>
      {detail && <span style={{ font: sans(isMobile ? 13 : 14.5), lineHeight: 1.45, color: 'var(--text-2)' }}>{detail}</span>}
    </div>
  )
}

function TextBlock({ label, editing, value, onChange }: { label: string; editing: boolean; value: string; onChange: (v: string) => void }) {
  return (
    <Block label={label}>
      {editing ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, height: 'auto', minHeight: 110, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }} />
      ) : (
        <span style={{ font: sans(14.5), lineHeight: 1.6, whiteSpace: 'pre-line' }}>{value || '—'}</span>
      )}
    </Block>
  )
}

function LinkRow({ label, meta, onClick }: { label: string; meta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}
    >
      <span style={{ font: sans(16, 500) }}>{label}</span>
      <span style={{ display: 'flex', gap: 12, font: mono(13), color: 'var(--text-2)' }}>
        {meta}
        <span style={{ color: 'var(--text)' }}>›</span>
      </span>
    </button>
  )
}

function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <summary style={{ cursor: 'pointer', font: sans(15, 500), listStyle: 'none', display: 'flex', justifyContent: 'space-between' }}>
        {title}
        <span style={{ color: 'var(--text-3)' }}>▾</span>
      </summary>
      <div style={{ paddingTop: 14 }}>{children}</div>
    </details>
  )
}

function QuestionnaireSummary({ q, answered, total, canEdit }: { q: Questionnaire; answered: number; total: number; canEdit: boolean }) {
  const nav = useNavigate()
  const [all, setAll] = useState(false)
  const rows = q.sections.flatMap((s) => s.questions).filter((question) => q.answers[question.key]?.trim())
  const shown = all ? rows : rows.slice(0, 7)
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--rule)' }}>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 24 }}>Ankieta kulinarna</span>
        <span style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <span style={{ font: mono(12), color: 'var(--text-2)' }}>{answered} / {total}</span>
          {canEdit && (
            <button type="button" onClick={() => nav('/profile/ankieta')} style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(14, 600), color: 'var(--accent-text)' }}>
              {answered === 0 ? 'Wypełnij ankietę' : 'Edytuj odpowiedzi'}
            </button>
          )}
        </span>
      </div>
      {rows.length === 0 && (
        <span style={{ padding: '14px 0', font: sans(14.5), color: 'var(--text-2)' }}>Im więcej odpowiedzi, tym lepiej asystent zna Waszą kuchnię.</span>
      )}
      {shown.map((question) => (
        <div key={question.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20, padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ font: sans(14), lineHeight: 1.45, color: 'var(--text-2)' }}>{question.label}</span>
          <span style={{ font: sans(15), lineHeight: 1.45 }}>{q.answers[question.key]}</span>
        </div>
      ))}
      {rows.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} style={{ alignSelf: 'flex-start', marginTop: 12, border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(14, 600), color: 'var(--text-2)' }}>
          Pokaż wszystkie odpowiedzi ({rows.length}) ▾
        </button>
      )}
    </div>
  )
}

/** The generated cookbook.md (what the assistant gets) + "Synchronizuj z ./context". */
function CookbookPanel({ canEdit }: { canEdit: boolean }) {
  const { data: cookbook } = useCookbook()
  const exportCtx = useExportContext()
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  async function onSync() {
    const r = await exportCtx.mutateAsync()
    setSyncMsg(`Wyeksportowano ${r.files.length} plików do ${r.path}`)
  }

  return (
    <div style={{ borderRadius: 14, overflow: 'hidden', background: 'var(--panel-bg)', color: 'var(--panel-text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '14px 18px', borderBottom: '1px solid var(--panel-border)' }}>
        <span style={{ font: mono(13, 500) }}>cookbook.md</span>
        <span style={{ font: sans(12.5), color: 'var(--panel-text-2)' }}>— wysyłane do AI na początku każdej rozmowy</span>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button type="button" onClick={onSync} style={{ height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--panel-text)', cursor: 'pointer', font: sans(12.5, 600) }}>
            {exportCtx.isPending ? 'Synchronizuję…' : 'Synchronizuj z ./context'}
          </button>
        )}
      </div>
      <pre style={{ margin: 0, padding: '18px 20px', font: mono(12.5), lineHeight: 1.7, color: 'var(--panel-text)', whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
        {cookbook?.markdown ?? 'Ładowanie…'}
      </pre>
      {syncMsg && <div style={{ padding: '0 20px 16px', font: mono(12), color: 'var(--accent-warm)' }}>{syncMsg} — otwórz ten folder w Codex lub Claude Code.</div>}
    </div>
  )
}

function EquipmentEditor({ editing, value, onChange }: { editing: boolean; value: Equipment[]; onChange: (e: Equipment[]) => void }) {
  const [name, setName] = useState('')
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {value.map((e, i) => (
        <Chip
          key={i}
          active={e.favorite}
          title={editing ? 'Kliknij, aby oznaczyć ulubiony' : undefined}
          onClick={editing ? () => onChange(value.map((x, j) => (j === i ? { ...x, favorite: !x.favorite } : x))) : undefined}
          style={{ font: sans(14, 500), padding: '8px 13px' }}
        >
          {e.favorite && '★ '}
          {e.name}
          {editing && (
            <span
              role="button"
              aria-label={`Usuń ${e.name}`}
              onClick={(ev) => {
                ev.stopPropagation()
                onChange(value.filter((_, j) => j !== i))
              }}
              style={{ opacity: 0.6, marginLeft: 2 }}
            >
              ✕
            </span>
          )}
        </Chip>
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
          style={{ height: 36, border: '1px dashed var(--border-2)', background: 'transparent', borderRadius: 999, padding: '0 14px', font: sans(13.5), color: 'var(--text)', width: 160 }}
        />
      )}
    </div>
  )
}
