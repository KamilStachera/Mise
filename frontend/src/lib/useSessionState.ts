import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/** sessionStorage read that never throws (private mode, blocked storage) and drops stale shapes. */
export function readSession<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw == null) return fallback
    const value: unknown = JSON.parse(raw)
    return valid && !valid(value) ? fallback : (value as T)
  } catch {
    return fallback
  }
}

export function writeSession(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable — the value just won't survive navigation */
  }
}

/**
 * useState mirrored to sessionStorage: the value survives leaving the page and
 * coming back in the same tab / app session (the recipe filters after opening a
 * recipe) and starts fresh in a new one. `valid` rejects values an older build
 * stored (a removed sort key) so they fall back to `initial`.
 */
export function useSessionState<T>(key: string, initial: T, valid?: (v: unknown) => boolean): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readSession(key, initial, valid))
  useEffect(() => writeSession(key, value), [key, value])
  return [value, setValue]
}
