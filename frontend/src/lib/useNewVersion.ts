import { useEffect, useState } from 'react'

// An installed PWA is resumed, not reloaded, so it can run the previous deploy for
// days. Vite hashes the entry bundle name; when the served index.html points at a
// different one, a newer version is live.

const ENTRY = /\/assets\/index-[\w-]+\.js/
const CHECK_EVERY_MS = 15 * 60 * 1000

/** The entry bundle this page booted with; null in the Vite dev server (no hashed bundle). */
function runningEntry(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src')
  return src?.match(ENTRY)?.[0] ?? null
}

/** True once the server serves a different build than the one running. */
export function useNewVersion(): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    const running = runningEntry()
    if (!running) return

    let stopped = false
    async function check() {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/', { cache: 'no-store' })
        const served = (await res.text()).match(ENTRY)?.[0]
        if (!stopped && served && served !== running) setAvailable(true)
      } catch {
        // Offline or mid-deploy — try again on the next resume.
      }
    }

    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [])

  return available
}
