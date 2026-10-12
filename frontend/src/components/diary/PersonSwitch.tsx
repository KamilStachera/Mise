import { useAuth, usePerson } from '../../api/hooks'
import { Chip } from '../ui'

/**
 * Whose diary the private screens show. Only for logged-in visitors and only when more than one
 * person keeps a diary (DIARY_PEOPLE) — otherwise renders nothing.
 */
export function PersonSwitch() {
  const { canEdit } = useAuth()
  const { id, own, people, pick } = usePerson()
  if (!canEdit || people.length < 2) return null
  return (
    <div role="group" aria-label="Czyj dziennik" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {people.map((p) => (
        <Chip key={p.id} active={p.id === id} onClick={() => pick(p.id === own ? null : p.id)} style={{ padding: '5px 12px' }}>
          {p.name}
        </Chip>
      ))}
    </div>
  )
}
