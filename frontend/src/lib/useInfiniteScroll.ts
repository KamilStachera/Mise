import { useEffect, useRef, useState } from 'react'
import { readSession, writeSession } from './useSessionState'

const BATCH_SIZE = 24

type Page = { resetKey: string; count: number }

/**
 * Keep filtering/counts global, but mount cards and request photos only in batches.
 * The batch count restarts when `resetKey` (the filters and sort) changes — not when
 * the same list is refetched — and, with `storageKey`, survives leaving the page, so
 * Back lands on a list as long as the one that was scrolled.
 */
export function useInfiniteScroll<T>(items: readonly T[], resetKey: string, storageKey?: string) {
  const [page, setPage] = useState<Page>(() => {
    const stored = storageKey ? readSession<Page | null>(storageKey, null) : null
    return stored?.resetKey === resetKey ? stored : { resetKey, count: BATCH_SIZE }
  })
  // Reset before rendering new filters or sorting.
  if (page.resetKey !== resetKey) setPage({ resetKey, count: BATCH_SIZE })
  const count = page.resetKey === resetKey ? page.count : BATCH_SIZE
  useEffect(() => {
    if (storageKey) writeSession(storageKey, page)
  }, [storageKey, page])

  const sentinel = useRef<HTMLDivElement>(null)
  const hasMore = count < items.length
  const grow = (current: Page): Page => current.resetKey === resetKey
    ? { resetKey, count: Math.min(current.count + BATCH_SIZE, items.length) }
    : current
  const loadMore = () => setPage(grow)

  useEffect(() => {
    const element = sentinel.current
    if (!element || !hasMore || typeof IntersectionObserver === 'undefined') return
    // The app scrolls <main>, not the window.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        setPage(grow)
      }
    }, { root: element.closest('main'), rootMargin: '400px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, resetKey, count, hasMore])

  return { visibleItems: items.slice(0, count), sentinel, hasMore, loadMore }
}
