export type OfflineAction =
  | { kind: 'shopping-check'; id: string; checked: boolean }
  | { kind: 'shopping-add'; name: string; category?: string }
  | { kind: 'supply-check'; id: string; checked: boolean }
  | { kind: 'supply-add'; name: string; category?: string }

const STORAGE_KEY = 'pichci.offline.queue.v1'
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

export function subscribeOfflineQueue(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function readOfflineQueue(): OfflineAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as OfflineAction[]) : []
  } catch {
    return []
  }
}

function writeOfflineQueue(items: OfflineAction[]): void {
  try {
    if (items.length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* private browsing / quota full */
  }
  emit()
}

/** Pure reducer — coalesces repeated check-offs for the same row so offline replays stay idempotent. */
export function appendOfflineAction(queue: OfflineAction[], action: OfflineAction): OfflineAction[] {
  if (action.kind === 'shopping-check' || action.kind === 'supply-check') {
    const filtered = queue.filter((item) => !(item.kind === action.kind && item.id === action.id))
    return [...filtered, action]
  }
  return [...queue, action]
}

export function enqueueOfflineAction(action: OfflineAction): number {
  const next = appendOfflineAction(readOfflineQueue(), action)
  writeOfflineQueue(next)
  return next.length
}

export function clearOfflineQueue(): void {
  writeOfflineQueue([])
}

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return err instanceof TypeError
}

export function clearSwApiCache(): void {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_API_CACHE' })
    }
  } catch {
    /* ignore */
  }
}

let flushing: Promise<number> | null = null

/** Replay queued offline shopping/supply mutations in order; stops on first network drop. */
export async function flushOfflineQueue(
  execute: (action: OfflineAction) => Promise<void>,
): Promise<number> {
  if (flushing) return flushing
  flushing = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
    const initial = readOfflineQueue()
    if (initial.length === 0) return 0

    let synced = 0
    const remaining = [...initial]
    while (remaining.length > 0) {
      const head = remaining[0]
      try {
        await execute(head)
        remaining.shift()
        synced++
        writeOfflineQueue(remaining)
      } catch (err) {
        if (isNetworkError(err)) break
        // Permanent 4xx (e.g. item already deleted by partner): drop so it never blocks the queue.
        remaining.shift()
        writeOfflineQueue(remaining)
      }
    }
    return synced
  })().finally(() => {
    flushing = null
  })
  return flushing
}
