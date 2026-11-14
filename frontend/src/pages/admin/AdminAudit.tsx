import { useAdminAudit } from '../../api/hooks'
import { Button } from '../../components/ui'
import { AuditList } from './shared'

/** The audit log: codes, joins, roles, blocks, keys, Sous — newest first. */
export function AdminAudit() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useAdminAudit()
  if (!data) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <AuditList events={data.pages.flat()} />
      {hasNextPage && (
        <Button variant="outline" style={{ alignSelf: 'flex-start' }} disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
          {isFetchingNextPage ? 'Ładowanie…' : 'Starsze'}
        </Button>
      )}
    </div>
  )
}
