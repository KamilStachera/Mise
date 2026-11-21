import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../api/hooks'
import { PersonSwitch } from '../diary/PersonSwitch'
import { Segmented } from '../ui'
import { useIsMobile } from '../../lib/useIsMobile'

type View = 'dzis' | 'plan' | 'historia' | 'cwiczenia'

/**
 * Dziś · Plan · Historia · Ćwiczenia, plus whose training it is. Signed-in only — anonymous visitors
 * just get the public catalog, so there is nothing to switch to.
 */
export function TrainingNav() {
  const { canEdit } = useAuth()
  const { pathname } = useLocation()
  const nav = useNavigate()
  const isMobile = useIsMobile()
  if (!canEdit) return null
  // Phones switch views in the shell's section strip (SectionNav).
  if (isMobile) return <PersonSwitch />
  const view: View = pathname.startsWith('/trening/plan') ? 'plan'
    : pathname.startsWith('/trening/historia') ? 'historia'
      : pathname.startsWith('/trening/cwiczenia') ? 'cwiczenia' : 'dzis'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <Segmented
        value={view}
        onChange={(v) => nav(`/trening/${v}`)}
        style={{ width: 380, maxWidth: '100%' }}
        items={[
          { key: 'dzis', label: 'Dziś' },
          { key: 'plan', label: 'Plan' },
          { key: 'historia', label: 'Historia' },
          { key: 'cwiczenia', label: 'Ćwiczenia' },
        ]}
      />
      <PersonSwitch />
    </div>
  )
}
