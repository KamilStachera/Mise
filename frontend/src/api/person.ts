import { useSyncExternalStore } from 'react'
import { setPersonHeader } from './client'

// Whose diary the private screens show (the Plan switcher). A per-viewer convenience, so it
// lives in localStorage; null = the caller's own diary (the server maps the Google login).
const STORAGE_KEY = 'pichci.diary.person'

function saved(): number | null {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isInteger(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

let picked = saved()
setPersonHeader(picked)
const listeners = new Set<() => void>()

export function pickPerson(id: number | null) {
  picked = id
  setPersonHeader(id)
  try {
    if (id == null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(id))
  } catch {
    /* private mode — the pick just won't survive a reload */
  }
  listeners.forEach((l) => l())
}

export function usePickedPerson(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => picked,
  )
}
