import { useState, type ReactNode } from 'react'
import { errorText, type CreatedInvite, type Invite } from '../api/client'
import { useHousehold, useHouseholdActions } from '../api/hooks'
import { Button, Eyebrow, SectionHead, inputStyle, mono, sans } from './ui'

const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' })
export const validUntil = (iso: string) => `ważny do ${dateFmt.format(new Date(iso))}`

/**
 * "Domownicy": who shares this kitchen. Owners invite people, rename the household and others,
 * and change roles; members see the list and may rename themselves.
 */
export function HouseholdCard() {
  const { data: household } = useHousehold()
  const actions = useHouseholdActions()
  const [editing, setEditing] = useState<{ kind: 'household' } | { kind: 'person'; id: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [fresh, setFresh] = useState<CreatedInvite | null>(null)

  if (!household) return null
  const manage = household.canManage

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionHead
        title={editing?.kind === 'household' ? editor : household.name}
        meta={editing?.kind === 'household' || !manage ? undefined
          : <TextButton onClick={() => startEdit({ kind: 'household' }, household.name)}>zmień nazwę</TextButton>}
        size={22}
      />
      <Eyebrow>Domownicy · wspólne przepisy, spiżarnia i zakupy; dziennik i trening każdy ma swój</Eyebrow>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {household.members.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 54, borderBottom: '1px solid var(--border)' }}>
            {editing?.kind === 'person' && editing.id === m.id ? editor : (
              <>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ font: sans(15.5, 500), display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {m.name}
                    {m.isSelf && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· ty</span>}
                    {m.role === 'owner' && <Badge>właściciel</Badge>}
                  </span>
                  {m.email && <span style={{ font: mono(12), color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</span>}
                </span>
                {manage && !m.isSelf && (
                  <TextButton onClick={() => actions.setRole.mutate({ id: m.id, role: m.role === 'owner' ? 'member' : 'owner' })}>
                    {m.role === 'owner' ? 'zwykły domownik' : 'uczyń właścicielem'}
                  </TextButton>
                )}
                {(manage || m.isSelf) && <TextButton onClick={() => startEdit({ kind: 'person', id: m.id }, m.name)}>zmień imię</TextButton>}
              </>
            )}
          </div>
        ))}
      </div>
      {actions.setRole.isError && (
        <span role="alert" style={{ font: sans(13.5), color: 'var(--accent-text)' }}>{errorText(actions.setRole.error)}</span>
      )}

      {manage && (fresh ? (
        <FreshCode invite={fresh} onDone={() => setFresh(null)}
          hint="Przekaż go domownikowi: loguje się w Pichci kontem Google i wpisuje kod. Jednorazowy." />
      ) : (
        <Button variant="outline" style={{ alignSelf: 'flex-start' }} disabled={actions.createJoinInvite.isPending}
          onClick={async () => setFresh(await actions.createJoinInvite.mutateAsync())}>
          Zaproś domownika
        </Button>
      ))}
      {manage && <PendingInvites invites={household.invites} onCancel={(id) => actions.deleteJoinInvite.mutate(id)} />}
      {!manage && (
        <span style={{ font: sans(13), color: 'var(--text-3)' }}>Nowych domowników zaprasza właściciel domu.</span>
      )}
    </div>
  )
}

/** A just-created invite code: shown once, with a copy button. */
export function FreshCode({ invite, hint, onDone }: { invite: CreatedInvite; hint: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <Eyebrow>Kod zaproszenia · {validUntil(invite.expiresAt)}</Eyebrow>
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
            Dla {i.role === 'owner' ? 'współwłaściciela' : 'domownika'} · {validUntil(i.expiresAt)}
          </span>
          <TextButton onClick={() => onCancel(i.id)}>anuluj</TextButton>
        </div>
      ))}
    </div>
  )
}

/** Small mono label (role, admin, blocked…). */
export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'gold' | 'sage' }) {
  const color = { muted: 'var(--text-2)', accent: 'var(--accent-text)', gold: 'var(--gold-text)', sage: 'var(--sage-text)' }[tone]
  return (
    <span style={{ font: mono(10.5, 500), letterSpacing: '.06em', textTransform: 'uppercase', color, border: '1px solid currentColor', borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

export function TextButton({ onClick, children, tone }: { onClick: () => void; children: ReactNode; tone?: 'danger' }) {
  return (
    <button type="button" onClick={onClick}
      style={{ border: 0, padding: 0, background: 'transparent', color: tone === 'danger' ? 'var(--accent-text)' : 'var(--text-2)', textDecoration: 'underline', cursor: 'pointer', font: sans(13), whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}
