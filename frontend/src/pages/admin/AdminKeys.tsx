import { useAdminActions, useAdminKeys } from '../../api/hooks'
import { Badge, TextButton } from '../../components/HouseholdCards'
import { mono, sans } from '../../components/ui'
import { Empty, ErrorLine, Row, ago, day } from './shared'

/** Every personal API key on the server (never the secret itself); revoke any of them. */
export function AdminKeys() {
  const { data: keys } = useAdminKeys()
  const actions = useAdminActions()
  if (!keys) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {keys.length === 0 && <Empty>Nikt jeszcze nie utworzył klucza API.</Empty>}
        {keys.map((k) => (
          <Row
            key={k.id}
            title={<>
              {k.name} <span style={{ font: mono(12.5), color: 'var(--text-2)' }}>{k.prefix}…</span>
              {k.revokedAt && <Badge tone="accent">unieważniony</Badge>}
            </>}
            meta={<>{k.personName} · {k.householdName} · utworzony {day(k.createdAt)} · użyty {ago(k.lastUsedAt)}</>}
            right={!k.revokedAt && (
              <TextButton tone="danger" onClick={() => {
                if (window.confirm(`Unieważnić klucz „${k.name}” (${k.personName})? Agent, który go używa, przestanie działać.`))
                  actions.revokeKey.mutate(k.id)
              }}>unieważnij</TextButton>
            )}
          />
        ))}
      </div>
      <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>Klucze tworzą ludzie sami w Profil → Połącz agenta. Klucz działa jako jego właściciel, w jego domu.</span>
      <ErrorLine error={actions.revokeKey.error} />
    </div>
  )
}
