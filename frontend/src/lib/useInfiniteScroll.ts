import { useEffect, useRef, useState } from 'react'

const BATCH_SIZE = 24

/** Keep filtering/counts global, but mount cards and request photos only in batches. */
export function useInfiniteScroll<T>(items: readonly T[]) {
  const [page, setPage] = useState({ items, count: BATCH_SIZE })
  // Reset before rendering new filters, sorting, or a refreshed collection.
  if (page.items !== items) setPage({ items, count: BATCH_SIZE })
  const count = page.items === items ? page.count : BATCH_SIZE
  const sentinel = useRef<HTMLDivElement>(null)
  const hasMore = count < items.length
  const loadMore = () => setPage((current) => ({
    items,
    count: Math.min((current.items === items ? current.count : BATCH_SIZE) + BATCH_SIZE, items.length),
  }))

  useEffect(() => {
    const element = sentinel.current
    if (!element || !hasMore || typeof IntersectionObserver === 'undefined') return
    // The app scrolls <main>, not the window.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        setPage((current) => current.items === items
          ? { items, count: Math.min(current.count + BATCH_SIZE, items.length) }
          : current)
      }
    }, { root: element.closest('main'), rootMargin: '400px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [items, count, hasMore])

  return { visibleItems: items.slice(0, count), sentinel, hasMore, loadMore }
}
