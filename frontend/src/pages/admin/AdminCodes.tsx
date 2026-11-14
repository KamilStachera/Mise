import { useState } from 'react'
import type { CreatedInvite, InviteStatus, Role } from '../../api/client'
import { useAdminActions, useAdminHouseholds, useAdminInvites, useAdminOverview } from '../../api/hooks'
import { Badge, FreshCode, TextButton } from '../../components/HouseholdCards'
import { Button, Chip, Eyebrow, Segmented, Sheet, inputStyle, sans } from '../../components/ui'
import { Empty, ErrorLine, Row, day, when } from './shared'

const STATUSES: { key: InviteStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'Otwarte' },
  { key: 'used', label: 'Wykorzystane' },
  { key: 'expired', label: 'Wygasłe' },
  { key: 'revoked', label: 'Anulowane' },
  { key: 'all', label: 'Wszystkie' },
]

const STATUS_LABEL: Record<InviteStatus, string> = { pending: 'otwarty', used: 'wykorzystany', expired: 'wygasł', revoked: 'anulowany' }

/** Code history and reissue: new-household codes (starter recipes) and join codes for any household. */
export function AdminCodes() {
  const [status, setStatus] = useState<InviteStatus | 'all'>('pending')
  const { data: invites } = useAdminInvites(status)
  const actions = useAdminActions()
  const [creating, setCreating] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {STATUSES.map((s) => <Chip key={s.key} active={status === s.key} onClick={() => setStatus(s.key)}>{s.label}</Chip>)}
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => setCreating(true)}>Nowy kod</Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {invites?.length === 0 && <Empty>Brak kodów w tym widoku.</Empty>}
        {invites?.map((i) => (
          <Row
            key={i.id}
            title={<>
              {i.kind === 'join' ? `Dołączenie do „${i.householdName ?? '?'}”` : `Nowy dom${i.householdName ? ` „${i.householdName}”` : ''}`}
              <Badge tone={i.status === 'pending' ? 'sage' : i.status === 'used' ? 'muted' : 'accent'}>{STATUS_LABEL[i.status]}</Badge>
              {i.kind === 'join' && i.role === 'owner' && <Badge>właściciel</Badge>}
            </>}
            meta={<>
              {i.kind === 'new-household' && `${i.starter === 'all' ? 'wszystkie przepisy' : i.starter === 'none' ? 'bez przepisów' : i.starterSources.join(', ')} · `}
              utworzył(a) {i.createdBy ?? '—'} {day(i.createdAt)}
              {i.status === 'used' && ` · użył(a) ${i.usedBy ?? '—'} ${i.usedAt ? when(i.usedAt) : ''}`}
              {i.status === 'pending' && ` · ważny do ${day(i.expiresAt)}`}
              {i.status === 'expired' && ` · wygasł ${day(i.expiresAt)}`}
              {i.status === 'revoked' && i.revokedAt && ` · anulowany ${day(i.revokedAt)}`}
            </>}
            right={(i.status === 'pending' || i.status === 'expired') && <>
              <TextButton onClick={() => actions.extendInvite.mutate(i.id)}>+7 dni</TextButton>
              <TextButton tone="danger" onClick={() => actions.revokeInvite.mutate(i.id)}>anuluj</TextButton>
            </>}
          />
        ))}
      </div>
      <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>
        Samego kodu nie da się odczytać ponownie (przechowujemy tylko jego skrót) — jeśli ktoś go zgubił, anuluj i utwórz nowy.
      </span>
      <ErrorLine error={actions.extendInvite.error ?? actions.revokeInvite.error} />

      <Sheet open={creating} onClose={() => setCreating(false)} title="Nowy kod zaproszenia">
        {creating && <NewCode />}
      </Sheet>
    </div>
  )
}

function NewCode() {
  const { data: overview } = useAdminOverview()
  const { data: households } = useAdminHouseholds()
  const actions = useAdminActions()
  const create = actions.createInvite
  const [kind, setKind] = useState<'new-household' | 'join'>('new-household')
  const [name, setName] = useState('')
  const [starter, setStarter] = useState<'none' | 'all' | 'sources'>('sources')
  const [sources, setSources] = useState<string[]>([])
  const [householdId, setHouseholdId] = useState<number | null>(null)
  const [role, setRole] = useState<Role>('member')
  const [fresh, setFresh] = useState<CreatedInvite | null>(null)

  if (fresh) {
    return <FreshCode invite={fresh} onDone={() => setFresh(null)} hint={kind === 'join'
      ? 'Osoba loguje się kontem Google i wpisuje kod — trafia do wybranego domu.'
      : 'Wyślij go znajomemu: loguje się kontem Google i wpisuje kod — powstaje jego własny dom.'} />
  }
  if (!overview) return null

  const picked = overview.sources.filter((s) => sources.includes(s.name)).reduce((n, s) => n + s.count, 0)
  const count = starter === 'all' ? overview.sourceRecipes : starter === 'sources' ? picked : 0
  const ready = kind === 'join' ? householdId != null : starter !== 'sources' || sources.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Segmented items={[{ key: 'new-household', label: 'Nowy dom' }, { key: 'join', label: 'Do istniejącego domu' }]}
        value={kind} onChange={setKind} />

      {kind === 'new-household' ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
            placeholder="Nazwa domu (opcjonalnie, np. „Kasia i Tomek”)" style={inputStyle} />
          <Eyebrow>Na start dostaje kopię przepisów z twojego domu</Eyebrow>
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
        </>
      ) : (
        <>
          <Eyebrow>Dom</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {households?.filter((h) => !h.blocked).map((h) => (
              <Chip key={h.id} active={householdId === h.id} onClick={() => setHouseholdId(h.id)}>{h.name}</Chip>
            ))}
          </div>
          <Eyebrow>Jako</Eyebrow>
          <Segmented items={[{ key: 'member', label: 'Domownik' }, { key: 'owner', label: 'Właściciel' }]} value={role} onChange={setRole} />
        </>
      )}

      <ErrorLine error={create.error} />
      <Button disabled={!ready || create.isPending} onClick={async () => setFresh(await create.mutateAsync(kind === 'join'
        ? { kind, householdId: householdId!, role }
        : { kind, householdName: name.trim() || undefined, starter, sources: starter === 'sources' ? sources : undefined }))}>
        Utwórz kod
      </Button>
    </div>
  )
}
