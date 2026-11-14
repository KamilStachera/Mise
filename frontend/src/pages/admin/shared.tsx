import type { ReactNode } from 'react'
import { errorText, type AuditEvent } from '../../api/client'
import { mono, sans } from '../../components/ui'

const dateTime = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })

/** "5 min temu", "3 godz. temu", "wczoraj", "12 lis 2026" — for last-seen columns. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'nigdy'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60_000)
  if (min < 2) return 'przed chwilą'
  if (min < 60) return `${min} min temu`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} godz. temu`
  const d = Math.round(h / 24)
  if (d === 1) return 'wczoraj'
  if (d < 14) return `${d} dni temu`
  return dateOnly.format(new Date(iso))
}

export const when = (iso: string) => dateTime.format(new Date(iso))
export const day = (iso: string) => dateOnly.format(new Date(iso))

/** One list row: main text + meta line on the left, actions on the right. */
export function Row({ title, meta, right, onClick }: { title: ReactNode; meta?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: onClick ? 'pointer' : undefined }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
        <span style={{ font: sans(15.5, 500), display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{title}</span>
        {meta && <span style={{ font: sans(12.5), color: 'var(--text-3)', lineHeight: 1.45 }}>{meta}</span>}
      </span>
      {right && <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>{right}</span>}
    </div>
  )
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null
  return <span role="alert" style={{ font: sans(13.5), color: 'var(--accent-text)' }}>{errorText(error, 'Nie udało się.')}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: '24px 0', font: sans(14), color: 'var(--text-3)' }}>{children}</div>
}

export function AuditList({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return <Empty>Jeszcze nic się nie wydarzyło.</Empty>
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {events.map((e) => (
        <div key={e.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 110px) minmax(0, 1fr)', gap: 14, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ font: mono(12), color: 'var(--text-3)', paddingTop: 2 }}>{when(e.at)}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ font: sans(14.5), lineHeight: 1.45 }}>{e.summary}</span>
            <span style={{ font: sans(12), color: 'var(--text-3)' }}>
              {e.actorName}{e.householdName ? ` · ${e.householdName}` : ''} · <span style={{ font: mono(11) }}>{e.kind}</span>
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
