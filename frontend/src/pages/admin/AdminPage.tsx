import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAdminOverview, useAuth } from '../../api/hooks'
import { Button, PageTitle, SectionHead, StatStrip, UnderlineTabs, usePagePad } from '../../components/ui'
import { AdminAudit } from './AdminAudit'
import { AdminCodes } from './AdminCodes'
import { AdminHouseholds } from './AdminHouseholds'
import { AdminKeys } from './AdminKeys'
import { AdminPeople } from './AdminPeople'
import { AuditList } from './shared'

type Tab = 'przeglad' | 'domy' | 'ludzie' | 'kody' | 'klucze' | 'dziennik'

const TABS: { key: Tab; label: string }[] = [
  { key: 'przeglad', label: 'Przegląd' },
  { key: 'domy', label: 'Domy' },
  { key: 'ludzie', label: 'Ludzie' },
  { key: 'kody', label: 'Kody' },
  { key: 'klucze', label: 'Klucze API' },
  { key: 'dziennik', label: 'Dziennik' },
]

/** The admin panel: households, people, invite codes, API keys and the audit log (admins only). */
export function AdminPage() {
  const { data: auth } = useAuth()
  const { pathname } = useLocation()
  const nav = useNavigate()
  const pad = usePagePad()

  if (auth && !auth.isAdmin) return <Navigate to="/" replace />
  const segment = pathname.split('/')[2] as Tab | undefined
  const tab: Tab = TABS.some((t) => t.key === segment) ? segment! : 'przeglad'

  return (
    <div style={{ ...pad, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageTitle title="Panel admina" sub="Domy, ludzie, kody zaproszeń, klucze API i dziennik zmian — dla wszystkich domów na tym serwerze." />
      <UnderlineTabs items={TABS} value={tab} onChange={(k) => nav(k === 'przeglad' ? '/admin' : `/admin/${k}`)} />
      {tab === 'przeglad' && <Overview onOpen={(k) => nav(`/admin/${k}`)} />}
      {tab === 'domy' && <AdminHouseholds />}
      {tab === 'ludzie' && <AdminPeople />}
      {tab === 'kody' && <AdminCodes />}
      {tab === 'klucze' && <AdminKeys />}
      {tab === 'dziennik' && <AdminAudit />}
    </div>
  )
}

function Overview({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const { data } = useAdminOverview()
  if (!data) return null
  const s = data.stats
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <StatStrip items={[
        { value: s.households, label: 'domy' },
        { value: s.people, label: 'osoby z kontem' },
        { value: s.activeLast7Days, label: 'aktywni (7 dni)' },
        { value: s.pendingInvites, label: 'otwarte kody', highlight: s.pendingInvites > 0 },
        { value: s.liveKeys, label: 'klucze API' },
        { value: s.blockedPeople, label: 'zablokowani' },
      ]} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Button onClick={() => onOpen('kody')}>Nowy kod zaproszenia</Button>
        <Button variant="outline" onClick={() => onOpen('domy')}>Domy i Sous</Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionHead title="Ostatnio" meta={<Button size="sm" variant="text" onClick={() => onOpen('dziennik')}>cały dziennik ›</Button>} size={22} />
        <AuditList events={data.recent} />
      </div>
    </div>
  )
}
