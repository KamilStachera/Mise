import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useLogout, usePreferences, useCookbook, useSavePreferences, useExportContext, useQuestionnaire, useHousehold } from '../api/hooks'
import { api, errorText, loginUrl, type Equipment, type Preferences, type Questionnaire } from '../api/client'
import { AppearanceSettings } from '../components/AppearanceSettings'
import { ConnectAgentCard } from '../components/ConnectAgentCard'
import { HouseholdCard, PortionSettingsCard } from '../components/HouseholdCards'
import { LoginPrompt } from '../components/LoginPrompt'
import { SousButton } from '../components/SousButton'
import { showToast } from '../lib/toastBus'
import { useIsMobile } from '../lib/useIsMobile'
import { Button, Chip, Eyebrow, PageTitle, SectionHead, UnderlineTabs, inputStyle, mono, sans, usePagePad } from '../components/ui'

type ProfileTab = 'kuchnia' | 'domownicy' | 'polaczenia' | 'wyglad'

/**
 * Profile ("Profil i dom" on desktop, "Profil" under "Ja" on phones).
 * Organized into three focused tabs — Kuchnia, Domownicy, Połączenia — so preferences,
 * household management, and AI/API setup never collide in one 3,000 px scroll.
 */
export function Profile() {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { data: auth, isLoading: authLoading, canEdit } = useAuth()
  const logout = useLogout()
  const { data: prefs } = usePreferences()
  const { data: questionnaire } = useQuestionnaire()
  const { data: household } = useHousehold()
  const save = useSavePreferences()

  const [tab, setTab] = useState<ProfileTab>('kuchnia')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [downloadingBackup, setDownloadingBackup] = useState(false)

  async function onDownloadBackup() {
    if (downloadingBackup) return
    setDownloadingBackup(true)
    try {
      const name = await api.downloadHouseholdExport()
      showToast(`Pobrano kopię zapasową: ${name}`)
    } catch (err) {
      showToast(errorText(err, 'Nie udało się przygotować kopii zapasowej.'))
    } finally {
      setDownloadingBackup(false)
    }
  }

  useEffect(() => {
    if (prefs && !editing) setDraft(prefs)
  }, [prefs, editing])

  if (!authLoading && !canEdit) return <LoginPrompt title="Profil i dom" />
  if (!prefs || !draft) return <div style={{ ...pad, color: 'var(--text-3)' }}>Ładowanie…</div>

  const view = editing ? draft : prefs
  function set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }
  async function onSave() {
    await save.mutateAsync(draft!)
    setEditing(false)
    showToast('Zapisano profil kulinarny')
  }

  const answered = questionnaire ? Object.values(questionnaire.answers).filter((v) => v.trim()).length : 0
  const totalQuestions = questionnaire ? questionnaire.sections.reduce((n, s) => n + s.questions.length, 0) : 0

  const editControls = canEdit && tab === 'kuchnia' && (editing ? (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>Anuluj</Button>
      <Button size="sm" onClick={onSave} disabled={save.isPending}>{save.isPending ? 'Zapisuję…' : 'Zapisz'}</Button>
    </div>
  ) : (
    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{isMobile ? 'Edytuj' : 'Edytuj profil'}</Button>
  ))

  const householdFact = (
    <Fact
      label="Gospodarstwo"
      editing={editing}
      summary={view.householdSummary}
      detail={view.householdDetail}
      onSummary={(v) => set('householdSummary', v)}
      onDetail={(v) => set('householdDetail', v)}
    />
  )
  const skillsFact = (
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

  return (
    <div style={{ ...pad, maxWidth: 1120, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 26 }}>
      <PageTitle
        eyebrow={isMobile ? 'Ja · Ustawienia' : 'Ustawienia'}
        title={isMobile ? 'Profil' : 'Profil i dom'}
        sub={!isMobile ? 'Preferencje kuchni, domownicy i połączenia z asystentem oraz urządzeniami.' : undefined}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {editControls}
            <SousButton variant="header" />
            {!canEdit && <Button onClick={() => { window.location.href = loginUrl('/profile') }}>Zaloguj przez Google</Button>}
          </div>
        }
      />

      <UnderlineTabs
        value={tab}
        onChange={(next) => { setEditing(false); setTab(next) }}
        items={[
          { key: 'kuchnia', label: 'Kuchnia' },
          { key: 'domownicy', label: 'Domownicy', count: household?.members.length },
          { key: 'polaczenia', label: 'Połączenia' },
          { key: 'wyglad', label: 'Wygląd' },
        ]}
      />

      {tab === 'kuchnia' && (
        isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: editing ? '1fr' : '1fr 1fr', gap: 16 }}>
              {householdFact}
              {skillsFact}
            </div>
            {equipment}
            {tastes}
            {avoid}
            <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--rule)' }}>
              <LinkRow label="Ankieta kulinarna" meta={totalQuestions ? `${answered}/${totalQuestions}` : ''} onClick={() => nav('/profile/ankieta')} />
            </div>
            {canEdit && <PortionSettingsCard />}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.25fr)', gap: 48, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {householdFact}
                {skillsFact}
                {equipment}
                {tastes}
                {avoid}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {questionnaire && <QuestionnaireSummary q={questionnaire} answered={answered} total={totalQuestions} canEdit={canEdit} />}
                {canEdit && <PortionSettingsCard />}
              </div>
            </div>
          </div>
        )
      )}

      {tab === 'domownicy' && (
        <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 28 }}>
          {canEdit && <HouseholdCard />}
          {auth?.isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
              <SectionHead title="Panel administratora" size={20} />
              <span style={{ font: sans(14), lineHeight: 1.5, color: 'var(--text-2)' }}>
                Domy, ludzie, uprawnienia, kody zaproszeń, klucze API i diagnostyka serwera.
              </span>
              <Button variant="outline" size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/admin')}>
                Otwórz panel admina ›
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === 'polaczenia' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 820 }}>
          {canEdit && (
            <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--rule)' }}>
              <LinkRow label="Opaska, waga i zegarek (Strava)" meta="Aktywność" onClick={() => nav('/plan/aktywnosc')} />
            </div>
          )}

          {canEdit && <ConnectAgentCard />}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionHead title="Plik pamięci asystenta" size={20} meta="cookbook.md" />
            {isMobile ? (
              <Collapsible title="Podgląd cookbook.md i synchronizacja">
                <CookbookPanel canEdit={canEdit} />
              </Collapsible>
            ) : (
              <CookbookPanel canEdit={canEdit} />
            )}
          </div>

          {canEdit && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '16px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ font: sans(15.5, 600) }}>Kopia danych domu</span>
                <span style={{ font: sans(13.5), color: 'var(--text-2)' }}>Przepisy, spiżarnia, historia i preferencje w jednym archiwum .zip.</span>
              </div>
              <Button variant="outline" size="sm" onClick={onDownloadBackup} disabled={downloadingBackup}>
                {downloadingBackup ? 'Przygotowuję .zip…' : 'Pobierz kopię (.zip)'}
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === 'wyglad' && (
        <div style={{ maxWidth: 680 }}>
          <AppearanceSettings />
        </div>
      )}

      {isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {canEdit ? (
            <Button variant="text" style={{ font: sans(14, 600), color: 'var(--text-2)' }} onClick={() => logout.mutate()}>
              Wyloguj ({auth?.name ?? auth?.email})
            </Button>
          ) : (
            <Button variant="outline" onClick={() => { window.location.href = loginUrl('/profile') }}>Zaloguj przez Google</Button>
          )}
          {auth?.isAdmin && (
            <Button variant="text" size="sm" style={{ color: 'var(--accent-text)' }} onClick={() => nav('/admin')}>
              Panel admina ›
            </Button>
          )}
        </div>
      )}
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
      <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: isMobile ? 20 : 28, lineHeight: 1.1 }}>{summary || '—'}</span>
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
      style={{ height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 0, border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)', textAlign: 'left' }}
    >
      <span style={{ font: sans(15.5, 500) }}>{label}</span>
      <span style={{ display: 'flex', gap: 10, font: mono(12.5), color: 'var(--text-2)', flexShrink: 0 }}>
        {meta}
        <span style={{ color: 'var(--text)' }}>›</span>
      </span>
    </button>
  )
}

function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <summary style={{ cursor: 'pointer', font: sans(15, 500), listStyle: 'none', display: 'flex', justifyContent: 'space-between' }}>
        {title}
        <span style={{ color: 'var(--text-3)' }}>{open ? '▴' : '▾'}</span>
      </summary>
      {open && <div style={{ paddingTop: 14 }}>{children}</div>}
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
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22 }}>Ankieta kulinarna</span>
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
        <div key={question.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ font: sans(14), lineHeight: 1.45, color: 'var(--text-2)' }}>{question.label}</span>
          <span style={{ font: sans(14.5), lineHeight: 1.45 }}>{q.answers[question.key]}</span>
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
    <div style={{ borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', overflow: 'hidden', background: 'var(--panel-bg)', color: 'var(--panel-text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--panel-border)' }}>
        <span style={{ font: mono(13, 500) }}>cookbook.md</span>
        <span style={{ font: sans(12.5), color: 'var(--panel-text-2)' }}>— wysyłane do AI na początku rozmowy</span>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button type="button" onClick={onSync} style={{ height: 32, padding: '0 12px', borderRadius: 9, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--panel-text)', cursor: 'pointer', font: sans(12.5, 600) }}>
            {exportCtx.isPending ? 'Synchronizuję…' : 'Synchronizuj z ./context'}
          </button>
        )}
      </div>
      <pre style={{ margin: 0, padding: '16px 18px', font: mono(12.5), lineHeight: 1.7, color: 'var(--panel-text)', whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
        {cookbook?.markdown ?? 'Ładowanie…'}
      </pre>
      {syncMsg && <div style={{ padding: '0 18px 14px', font: mono(12), color: 'var(--accent-warm)' }}>{syncMsg}</div>}
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
