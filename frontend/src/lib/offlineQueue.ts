export type OfflineAction =
  | { kind: 'shopping-check'; id: string; checked: boolean }
  | { kind: 'shopping-add'; name: string; category?: string }
  | { kind: 'supply-check'; id: string; checked: boolean }
  | { kind: 'supply-add'; name: string; category?: string }

const STORAGE_KEY = 'pichci.offline.queue.v1'
/** Household the queued actions were made in: they only make sense replayed there. */
const OWNER_KEY = 'pichci.offline.queue.owner.v1'
const listeners = new Set<() => void>()

/** The signed-in household (from /api/auth/me); null until known or when not a member. */
let currentOwner: string | null = null

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(owner: string | null): void {
  try {
    if (owner === null) localStorage.removeItem(OWNER_KEY)
    else localStorage.setItem(OWNER_KEY, owner)
  } catch {
    /* private browsing / quota full */
  }
}

/**
 * Pure rule for a queue written by `stored` while `current` is signed in: wait until we know who
 * is signed in, replay in the same household (or for a legacy queue with no owner), otherwise
 * discard — another household's check-offs can't be applied to this list.
 */
export function offlineQueueDecision(stored: string | null, current: string | null): 'wait' | 'replay' | 'discard' {
  if (current === null) return 'wait'
  return stored === null || stored === current ? 'replay' : 'discard'
}

/** Called whenever /api/auth/me resolves; drops a queue left behind by a different household. */
export function setOfflineQueueOwner(owner: string | null): void {
  currentOwner = owner
  if (offlineQueueDecision(readOwner(), owner) === 'discard') clearOfflineQueue()
}

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
  if (items.length === 0) writeOwner(null)
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
  if (currentOwner !== null && readOwner() === null) writeOwner(currentOwner)
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
    const decision = offlineQueueDecision(readOwner(), currentOwner)
    if (decision === 'wait') return 0
    if (decision === 'discard') {
      clearOfflineQueue()
      return 0
    }

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
