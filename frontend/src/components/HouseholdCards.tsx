import { useState, type ReactNode } from 'react'
import { errorText, type CreatedInvite, type Invite } from '../api/client'
import { useAdminOverview, useAuth, useHousehold, useHouseholdActions } from '../api/hooks'
import { Button, Chip, Eyebrow, SectionHead, Segmented, Toggle, inputStyle, mono, sans } from './ui'

const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' })
const until = (iso: string) => `ważny do ${dateFmt.format(new Date(iso))}`

/** "Domownicy": who shares this kitchen, renaming, and join codes for a partner. */
export function HouseholdCard() {
  const { data: household } = useHousehold()
  const actions = useHouseholdActions()
  const [editing, setEditing] = useState<{ kind: 'household' } | { kind: 'person'; id: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [fresh, setFresh] = useState<CreatedInvite | null>(null)

  if (!household) return null

  function startEdit(target: NonNullable<typeof editing>, value: string) {
    setEditing(target)
    setDraft(value)
  }
  async function saveEdit() {
    const name = draft.trim()
    if (!editing || !name) return
    if (editing.kind === 'household') await actions.rename.mutateAsync(name)
    else await actions.renamePerson.mutateAsync({ id: editing.id, name })
    setEditing(null)
  }
  const editor = (
    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80} autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null) }}
        style={{ ...inputStyle, height: 38, flex: 1, minWidth: 0 }} />
      <Button size="sm" onClick={saveEdit}>Zapisz</Button>
    </span>
  )

  return (
    <Card>
      <SectionHead
        title={editing?.kind === 'household' ? editor : household.name}
        meta={editing?.kind === 'household' ? undefined : <TextButton onClick={() => startEdit({ kind: 'household' }, household.name)}>zmień nazwę</TextButton>}
        size={22}
      />
      <Eyebrow>Domownicy · wspólne przepisy, spiżarnia i zakupy; dziennik i trening każdy ma swój</Eyebrow>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {household.members.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, borderBottom: '1px solid var(--border)' }}>
            {editing?.kind === 'person' && editing.id === m.id ? editor : (
              <>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ font: sans(15.5, 500) }}>{m.name}{m.isSelf && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · ty</span>}</span>
                  {m.email && <span style={{ font: mono(12), color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</span>}
                </span>
                <TextButton onClick={() => startEdit({ kind: 'person', id: m.id }, m.name)}>zmień</TextButton>
              </>
            )}
          </div>
        ))}
      </div>

      {fresh ? (
        <FreshCode invite={fresh} onDone={() => setFresh(null)}
          hint="Przekaż go domownikowi: loguje się w Pichci kontem Google i wpisuje kod. Jednorazowy." />
      ) : (
        <Button variant="outline" style={{ alignSelf: 'flex-start' }} disabled={actions.createJoinInvite.isPending}
          onClick={async () => setFresh(await actions.createJoinInvite.mutateAsync())}>
          Zaproś domownika
        </Button>
      )}
      <PendingInvites invites={household.invites} onCancel={(id) => actions.deleteJoinInvite.mutate(id)} />
    </Card>
  )
}

/** Admin only: every household, Sous per household, and codes that create a new household. */
export function AdminHouseholdsCard() {
  const { data: auth } = useAuth()
  const { data: overview } = useAdminOverview(auth?.isAdmin === true)
  const actions = useHouseholdActions()
  const [name, setName] = useState('')
  const [starter, setStarter] = useState<'none' | 'all' | 'sources'>('sources')
  const [sources, setSources] = useState<string[]>([])
  const [fresh, setFresh] = useState<CreatedInvite | null>(null)

  if (!auth?.isAdmin || !overview) return null

  const picked = overview.sources.filter((s) => sources.includes(s.name)).reduce((n, s) => n + s.count, 0)
  const count = starter === 'all' ? overview.sourceRecipes : starter === 'sources' ? picked : 0
  const create = actions.createHouseholdInvite

  return (
    <Card>
      <SectionHead title="Gospodarstwa" meta="administrator" size={22} />
      <Eyebrow>Każdy dom ma własne przepisy, spiżarnię, zakupy i domowników — nie widzą się nawzajem</Eyebrow>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {overview.households.map((h) => (
          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 58, borderBottom: '1px solid var(--border)' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
              <span style={{ font: sans(15.5, 500) }}>{h.name}{h.id === auth.household?.id && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · twój</span>}</span>
              <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
                {h.members.length ? h.members.join(', ') : 'bez domowników'} · {h.recipes} przepisów
              </span>
            </span>
            <Toggle on={h.sousEnabled} label="Sous" onChange={(v) => actions.patchHousehold.mutate({ id: h.id, sousEnabled: v })} />
          </div>
        ))}
      </div>
      <span style={{ font: sans(12.5), lineHeight: 1.5, color: 'var(--text-3)' }}>
        Sous działa na twoim planie ChatGPT — włączaj go tylko domom, którym chcesz go udostępnić.
      </span>

      {fresh ? (
        <FreshCode invite={fresh} onDone={() => setFresh(null)}
          hint="Wyślij go znajomemu: loguje się kontem Google i wpisuje kod — powstaje jego własny dom. Jednorazowy." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
          <span style={{ font: sans(15.5, 500) }}>Nowy dom dla znajomego</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
            placeholder="Nazwa domu (opcjonalnie, np. „Kasia i Tomek”)" style={inputStyle} />
          <Eyebrow>Na start dostaje kopię przepisów</Eyebrow>
          <Segmented
            items={[
              { key: 'sources', label: 'Wybrane źródła' },
              { key: 'all', label: `Wszystkie (${overview.sourceRecipes})` },
              { key: 'none', label: 'Żadnych' },
            ]}
            value={starter}
            onChange={setStarter}
          />
          {starter === 'sources' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {overview.sources.map((s) => (
                <Chip key={s.name} active={sources.includes(s.name)}
                  onClick={() => setSources((list) => list.includes(s.name) ? list.filter((x) => x !== s.name) : [...list, s.name])}>
                  {s.name} · {s.count}
                </Chip>
              ))}
              {overview.sources.length === 0 && <span style={{ font: sans(13.5), color: 'var(--text-3)' }}>Twoje przepisy nie mają jeszcze źródeł.</span>}
            </div>
          )}
          <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
            {count > 0 ? `${count} przepisów zostanie skopiowanych (ze zdjęciami) — potem to już ich własne kopie.` : 'Dostanie tylko kilka przykładowych przepisów.'}
          </span>
          {create.isError && <span role="alert" style={{ font: sans(13.5), color: 'var(--accent-text)' }}>{errorText(create.error)}</span>}
          <Button style={{ alignSelf: 'flex-start' }} disabled={create.isPending || (starter === 'sources' && sources.length === 0)}
            onClick={async () => {
              setFresh(await create.mutateAsync({ householdName: name.trim() || undefined, starter, sources: starter === 'sources' ? sources : undefined }))
              setName('')
            }}>
            Utwórz kod zaproszenia
          </Button>
        </div>
      )}
      <PendingInvites invites={overview.invites} onCancel={(id) => actions.deleteHouseholdInvite.mutate(id)} />
    </Card>
  )
}

function FreshCode({ invite, hint, onDone }: { invite: CreatedInvite; hint: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <Eyebrow>Kod zaproszenia · {until(invite.expiresAt)}</Eyebrow>
      <span style={{ font: mono(26, 500), letterSpacing: '0.12em', userSelect: 'all' }}>{invite.code}</span>
      <span style={{ font: sans(13.5), lineHeight: 1.5, color: 'var(--text-2)' }}>{hint} Nie zobaczysz go ponownie.</span>
      <span style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" variant="outline" onClick={async () => {
          await navigator.clipboard.writeText(`${invite.code} — ${window.location.origin}`)
          setCopied(true)
        }}>{copied ? '✓ Skopiowano' : 'Kopiuj z linkiem'}</Button>
        <Button size="sm" variant="quiet" onClick={onDone}>Gotowe</Button>
      </span>
    </div>
  )
}

function PendingInvites({ invites, onCancel }: { invites: Invite[]; onCancel: (id: string) => void }) {
  if (invites.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Eyebrow>Niewykorzystane kody</Eyebrow>
      {invites.map((i) => (
        <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, font: sans(13.5), color: 'var(--text-2)' }}>
          <span style={{ flex: 1 }}>
            {i.householdName ?? (i.kind === 'join' ? 'Dla domownika' : 'Nowy dom')}
            {i.kind === 'new-household' && ` · ${i.starter === 'all' ? 'wszystkie przepisy' : i.starter === 'none' ? 'bez przepisów' : i.starterSources.join(', ')}`}
            {' · '}{until(i.expiresAt)}
          </span>
          <TextButton onClick={() => onCancel(i.id)}>anuluj</TextButton>
        </div>
      ))}
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
}

function TextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--text-2)', textDecoration: 'underline', cursor: 'pointer', font: sans(13) }}>
      {children}
    </button>
  )
}
