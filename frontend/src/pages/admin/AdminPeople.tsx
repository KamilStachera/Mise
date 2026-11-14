import { useState } from 'react'
import type { AdminPerson } from '../../api/client'
import { useAdminActions, useAdminHouseholds, useAdminPeople, useAuth } from '../../api/hooks'
import { Badge, TextButton } from '../../components/HouseholdCards'
import { Button, Chip, Eyebrow, SearchField, Segmented, Sheet, Toggle, inputStyle, mono, sans } from '../../components/ui'
import { Empty, ErrorLine, Row, ago, day } from './shared'

const STATUSES = [
  { key: 'all', label: 'Wszyscy' },
  { key: 'active', label: 'Aktywni' },
  { key: 'admins', label: 'Admini' },
  { key: 'blocked', label: 'Zablokowani' },
  { key: 'unlinked', label: 'Bez konta' },
]

/** Everyone on the server: search, filter by household/status; roles, admin, block, unlink. */
export function AdminPeople() {
  const [q, setQ] = useState('')
  const [householdId, setHouseholdId] = useState<number | undefined>()
  const [status, setStatus] = useState('all')
  const { data: people } = useAdminPeople({ q: q.trim() || undefined, householdId, status })
  const { data: households } = useAdminHouseholds()
  const [open, setOpen] = useState<AdminPerson | null>(null)
  const current = people?.find((p) => p.id === open?.id) ?? open

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SearchField value={q} onChange={setQ} placeholder="Szukaj po imieniu, e-mailu albo domu" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {STATUSES.map((s) => <Chip key={s.key} active={status === s.key} onClick={() => setStatus(s.key)}>{s.label}</Chip>)}
      </div>
      {households && households.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Chip active={householdId == null} onClick={() => setHouseholdId(undefined)}>Każdy dom</Chip>
          {households.map((h) => <Chip key={h.id} active={householdId === h.id} onClick={() => setHouseholdId(h.id)}>{h.name}</Chip>)}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {people?.length === 0 && <Empty>Nikogo takiego.</Empty>}
        {people?.map((p) => (
          <Row
            key={p.id}
            onClick={() => setOpen(p)}
            title={<>
              {p.name}
              {p.role === 'owner' && <Badge>właściciel</Badge>}
              {p.isAdmin && <Badge tone="gold">admin</Badge>}
              {(p.blocked || p.householdBlocked) && <Badge tone="accent">{p.blocked ? 'zablokowany' : 'dom zablokowany'}</Badge>}
              {!p.email && <Badge>bez konta</Badge>}
            </>}
            meta={<>
              <span style={{ font: mono(12) }}>{p.email ?? '—'}</span> · {p.householdName} · aktywność {ago(p.lastSeenAt)}
              {p.keys > 0 && ` · ${p.keys} ${p.keys === 1 ? 'klucz' : 'klucze'} API`}
            </>}
            right={<span style={{ font: sans(13), color: 'var(--text-2)' }}>›</span>}
          />
        ))}
      </div>

      <Sheet open={current != null} onClose={() => setOpen(null)} title={current?.name}>
        {current && <PersonEditor person={current} />}
      </Sheet>
    </div>
  )
}

function PersonEditor({ person }: { person: AdminPerson }) {
  const { data: auth } = useAuth()
  const actions = useAdminActions()
  const [name, setName] = useState(person.name)
  const self = person.id === auth?.personId && person.householdId === auth?.household?.id
  const patch = actions.patchPerson
  const error = patch.error ?? actions.unlinkPerson.error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <span style={{ font: sans(13.5), color: 'var(--text-2)', lineHeight: 1.6 }}>
        <span style={{ font: mono(12.5) }}>{person.email ?? 'bez podłączonego konta Google'}</span><br />
        {person.householdName} · od {day(person.createdAt)} · aktywność {ago(person.lastSeenAt)}
      </span>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Eyebrow>Imię</Eyebrow>
        <span style={{ display: 'flex', gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} style={{ ...inputStyle, flex: 1 }} />
          <Button size="sm" disabled={!name.trim() || name.trim() === person.name || patch.isPending}
            onClick={() => patch.mutate({ id: person.id, name: name.trim() })}>Zapisz</Button>
        </span>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Eyebrow>Rola w domu</Eyebrow>
        <Segmented items={[{ key: 'member', label: 'Domownik' }, { key: 'owner', label: 'Właściciel' }]}
          value={person.role} onChange={(role) => patch.mutate({ id: person.id, role })} />
        <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>Właściciel zaprasza ludzi, zmienia nazwę domu i role.</span>
      </div>

      <Toggle on={person.isAdmin} disabled={self || person.envAdmin || !person.email} label="Administrator serwera"
        onChange={(v) => patch.mutate({ id: person.id, isAdmin: v })} />
      {person.envAdmin && <span style={{ font: sans(12.5), color: 'var(--text-3)', marginTop: -10 }}>Admin z ADMIN_EMAILS — zmienia się w .env.</span>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
        <Toggle on={person.blocked} disabled={self || person.envAdmin} label="Zablokowany"
          onChange={(v) => {
            if (v && !window.confirm(`Zablokować ${person.name}? Nie zaloguje się, a jego/jej klucze API przestaną działać. Dane zostają, można odblokować.`)) return
            patch.mutate({ id: person.id, blocked: v })
          }} />
        {person.email && !self && !person.envAdmin && (
          <span>
            <TextButton tone="danger" onClick={() => {
              if (!window.confirm(`Odłączyć konto ${person.email} od ${person.name}? Konto straci dostęp (będzie mogło użyć nowego kodu), dziennik i dane zostają w domu, klucze API zostaną unieważnione.`)) return
              actions.unlinkPerson.mutate(person.id)
            }}>Odłącz konto Google</TextButton>
          </span>
        )}
      </div>
      <ErrorLine error={error} />
    </div>
  )
}
