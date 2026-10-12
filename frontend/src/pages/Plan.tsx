import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../api/hooks'
import { PersonSwitch } from '../components/diary/PersonSwitch'
import { Segmented } from '../components/ui'
import { mondayOf, parseISODate, toISO } from '../lib/dates'
import { useIsMobile } from '../lib/useIsMobile'
import { ActivityView } from './plan/ActivityView'
import { DayView } from './plan/DayView'
import { ProgressView } from './plan/ProgressView'
import { WeekView } from './plan/WeekView'

type View = 'dzien' | 'tydzien' | 'postepy' | 'aktywnosc'

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * Plan shell: Dzień (the diary, default on phones) and Tydzień (the week grid, default on
 * desktop and for anonymous visitors). The selected day/week lives in the URL (?d=), so the
 * back button and reloads keep it.
 */
export function Plan() {
  const isMobile = useIsMobile()
  const { canEdit, isLoading } = useAuth()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const nav = useNavigate()

  const view: View | null = pathname.startsWith('/plan/dzien') ? 'dzien'
    : pathname.startsWith('/plan/tydzien') ? 'tydzien'
    : pathname.startsWith('/plan/postepy') ? 'postepy'
    : pathname.startsWith('/plan/aktywnosc') ? 'aktywnosc' : null
  const d = params.get('d')
  const day = d && ISO.test(d) ? d : toISO(new Date())

  if (view === null) {
    if (isLoading) return null
    return <Navigate to={isMobile && canEdit ? '/plan/dzien' : '/plan/tydzien'} replace />
  }

  const go = (v: View, iso: string) => nav(`/plan/${v}${iso === toISO(new Date()) ? '' : `?d=${iso}`}`, { replace: v === view })

  const switcher = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      <PersonSwitch />
      <Segmented
        value={view === 'aktywnosc' ? 'dzien' : view}
        onChange={(v) => go(v, day)}
        style={{ width: isMobile ? 230 : 300 }}
        items={[
          { key: 'dzien', label: 'Dzień' },
          { key: 'tydzien', label: 'Tydzień' },
          { key: 'postepy', label: 'Postępy' },
        ]}
      />
    </div>
  )

  if (view === 'postepy') return <ProgressView switcher={switcher} />
  if (view === 'aktywnosc') return <ActivityView />

  return view === 'dzien' ? (
    <DayView day={day} onDay={(iso) => go('dzien', iso)} switcher={switcher} />
  ) : (
    <WeekView
      weekStart={mondayOf(parseISODate(day))}
      onWeek={(monday) => go('tydzien', toISO(monday))}
      onDay={(iso) => go('dzien', iso)}
      switcher={switcher}
    />
  )
}
