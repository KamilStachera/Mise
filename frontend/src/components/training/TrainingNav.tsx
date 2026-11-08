import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../api/hooks'
import { PersonSwitch } from '../diary/PersonSwitch'
import { Segmented } from '../ui'

type View = 'dzis' | 'plan' | 'cwiczenia'

/**
 * Dziś · Plan · Ćwiczenia, plus whose training it is. Signed-in only — anonymous visitors
 * just get the public catalog, so there is nothing to switch to.
 */
export function TrainingNav() {
  const { canEdit } = useAuth()
  const { pathname } = useLocation()
  const nav = useNavigate()
  if (!canEdit) return null
  const view: View = pathname.startsWith('/trening/plan') ? 'plan'
    : pathname.startsWith('/trening/cwiczenia') ? 'cwiczenia' : 'dzis'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <Segmented
        value={view}
        onChange={(v) => nav(`/trening/${v}`)}
        style={{ width: 300, maxWidth: '100%' }}
        items={[
          { key: 'dzis', label: 'Dziś' },
          { key: 'plan', label: 'Plan' },
          { key: 'cwiczenia', label: 'Ćwiczenia' },
        ]}
      />
      <PersonSwitch />
    </div>
  )
}
