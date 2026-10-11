import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAddCookLog, useAuth, useDismissCookReminder, usePendingCook } from '../api/hooks'
import type { PlanEntry } from '../api/client'
import { showToast } from '../lib/toastBus'
import { slotLabel } from '../lib/labels'
import { parseISODate } from '../lib/dates'
import { Button, Sheet, sans } from './ui'

// Shown at most once per browser session, so navigating around the app
// doesn't re-nag; a fresh tab or the next visit asks again.
const SESSION_KEY = 'pichci.pendingCookSeen'

function seenThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Login/entry reminder: past plan entries that never got a cook-log entry.
 * Each row can be logged as cooked (dated on the planned day — rating and note
 * can be added later from Historia) or dismissed for good (meal skipped).
 */
export function PendingCookModal() {
  const nav = useNavigate()
  const { canEdit } = useAuth()
  const { data: pending = [], isLoading } = usePendingCook(canEdit)
  const [closed, setClosed] = useState(seenThisSession)

  const open = canEdit && !isLoading && !closed && pending.length > 0

  function close() {
    try {
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      /* storage blocked — the modal just may come back on reload */
    }
    setClosed(true)
  }

  return (
    <Sheet open={open} onClose={close} title="Zaległe posiłki z planu">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ font: sans(14.5), lineHeight: 1.5, color: 'var(--text-2)' }}>
          Te zaplanowane posiłki nie mają wpisu w historii. Ugotowane? Ocenę i notatkę dopiszesz później w Historii.
        </span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {pending.map((e) => <PendingRow key={e.id} entry={e} />)}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="quiet" onClick={() => { close(); nav('/plan') }}>Otwórz plan</Button>
          <Button variant="dark" onClick={close}>Przypomnij później</Button>
        </div>
      </div>
    </Sheet>
  )
}

function PendingRow({ entry }: { entry: PlanEntry }) {
  const addLog = useAddCookLog()
  const dismiss = useDismissCookReminder()
  const busy = addLog.isPending || dismiss.isPending
  const title = entry.recipeTitle ?? entry.title
  const when = parseISODate(entry.date).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long' })

  function markCooked() {
    addLog.mutate(
      {
        recipeId: entry.recipeId ?? undefined,
        dishName: entry.recipeId ? undefined : title,
        cookedAt: entry.date,
      },
      { onSuccess: () => showToast(`Zapisano w historii: ${title}.`) },
    )
  }

  const small = { height: 34, padding: '0 12px', font: sans(13, 600) }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ font: sans(12.5), color: 'var(--text-3)' }}>{when} · {slotLabel[entry.slot]}</span>
      </div>
      <Button size="sm" style={small} onClick={markCooked} disabled={busy} title="Dodaj wpis do historii z datą z planu">✓ Ugotowane</Button>
      <Button size="sm" variant="quiet" style={small} onClick={() => dismiss.mutate(entry.id)} disabled={busy} title="Nie przypominaj o tym posiłku (np. pominięty)">Pomiń</Button>
    </div>
  )
}
