import { useState } from 'react'
import type { AdminHousehold, CreatedInvite } from '../../api/client'
import { useAdminActions, useAdminHouseholds, useAuth } from '../../api/hooks'
import { Badge, FreshCode } from '../../components/HouseholdCards'
import { Button, Eyebrow, Segmented, Sheet, Toggle, inputStyle, sans } from '../../components/ui'
import { ErrorLine, Row, ago, day } from './shared'

/** Every household: members, counts, last activity; rename, Sous, block, and join codes for it. */
export function AdminHouseholds() {
  const { data: households } = useAdminHouseholds()
  const { data: auth } = useAuth()
  const [open, setOpen] = useState<number | null>(null)
  const current = households?.find((h) => h.id === open) ?? null

  if (!households) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {households.map((h) => (
        <Row
          key={h.id}
          onClick={() => setOpen(h.id)}
          title={<>
            {h.name}
            {h.id === auth?.household?.id && <Badge>twój</Badge>}
            {h.sousEnabled && <Badge tone="gold">Sous</Badge>}
            {h.blocked && <Badge tone="accent">zablokowany</Badge>}
          </>}
          meta={<>
            {h.members.length ? h.members.map((m) => `${m.name}${m.role === 'owner' ? ' ★' : ''}${m.blocked ? ' (blok.)' : ''}`).join(', ') : 'bez domowników'}
            {' · '}{h.recipes} przepisów · {h.planEntries} wpisów w planie · aktywność {ago(h.lastSeenAt)} · od {day(h.createdAt)}
          </>}
          right={<span style={{ font: sans(13), color: 'var(--text-2)' }}>›</span>}
        />
      ))}
      <span style={{ font: sans(12.5), color: 'var(--text-3)', paddingTop: 10 }}>★ = właściciel. Sous działa na twoim planie ChatGPT — włączaj go tylko tam, gdzie chcesz.</span>
      <Sheet open={current != null} onClose={() => setOpen(null)} title={current?.name}>
        {current && <HouseholdEditor household={current} own={current.id === auth?.household?.id} />}
      </Sheet>
    </div>
  )
}

function HouseholdEditor({ household, own }: { household: AdminHousehold; own: boolean }) {
  const actions = useAdminActions()
  const [name, setName] = useState(household.name)
  const [role, setRole] = useState<'member' | 'owner'>('member')
  const [fresh, setFresh] = useState<CreatedInvite | null>(null)
  const patch = actions.patchHousehold
  const error = patch.error ?? actions.createInvite.error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Eyebrow>Nazwa</Eyebrow>
        <span style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} style={{ ...inputStyle, flex: 1 }} />
          <Button size="sm" disabled={!name.trim() || name.trim() === household.name || patch.isPending}
            onClick={() => patch.mutate({ id: household.id, name: name.trim() })}>Zapisz</Button>
        </span>
      </label>

      <Toggle on={household.sousEnabled} label="Sous (czat AI na twoim planie ChatGPT)"
        onChange={(v) => patch.mutate({ id: household.id, sousEnabled: v })} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Toggle on={household.blocked} disabled={own} label="Zablokowany"
          onChange={(v) => {
            if (v && !window.confirm(`Zablokować „${household.name}”? Nikt z tego domu nie zaloguje się ani nie użyje kluczy API. Dane zostają, można odblokować.`)) return
            patch.mutate({ id: household.id, blocked: v })
          }} />
        {own && <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>Własnego domu nie możesz zablokować.</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
        <Eyebrow>Kod dołączenia do tego domu</Eyebrow>
        {fresh ? (
          <FreshCode invite={fresh} onDone={() => setFresh(null)} hint="Osoba loguje się kontem Google i wpisuje kod." />
        ) : (
          <>
            <Segmented items={[{ key: 'member', label: 'Domownik' }, { key: 'owner', label: 'Właściciel' }]} value={role} onChange={setRole} />
            <Button variant="outline" style={{ alignSelf: 'flex-start' }} disabled={actions.createInvite.isPending}
              onClick={async () => setFresh(await actions.createInvite.mutateAsync({ kind: 'join', householdId: household.id, role }))}>
              Utwórz kod
            </Button>
          </>
        )}
      </div>
      <ErrorLine error={error} />
    </div>
  )
}
