import React from 'react'
import ReactDOM from 'react-dom/client'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ApiError, api, type AuthMe, type SupplyCategory } from './api/client'
import { flushOfflineQueue, setOfflineQueueOwner, type OfflineAction } from './lib/offlineQueue'
import { plural } from './lib/labels'
import { showToast } from './lib/toastBus'
import { initTheme } from './lib/theme'
import './theme/tokens.css'

initTheme()

// Reload once if a new deploy replaces hashed lazy chunks while an older tab is still open.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  const key = 'pichci:chunk-reload'
  try {
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      window.location.reload()
    }
  } catch {
    window.location.reload()
  }
})

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 5_000 } },
  // Backstop for expired sessions: write UI is hidden when anonymous, but a
  // mutation can still 401 mid-session — surface it and refresh the auth state.
  mutationCache: new MutationCache({
    // Every other failure gets a toast too, so a save never fails silently (the
    // plan's "do zakupów" button 500'd for days with no sign on the phone).
    onError: (error, _vars, _ctx, mutation) => {
      if (error instanceof ApiError && error.status === 401) {
        showToast('Zaloguj się, aby wprowadzać zmiany.')
        queryClient.invalidateQueries({ queryKey: ['auth'] })
      } else if (!mutation.meta?.ownErrors) {
        showToast(error instanceof ApiError && error.status >= 500
          ? 'Coś poszło nie tak po stronie serwera — nic nie zapisano. Spróbuj ponownie.'
          : 'Nie udało się zapisać. Sprawdź połączenie i spróbuj ponownie.')
      }
    },
  }),
})

async function runOfflineAction(action: OfflineAction): Promise<void> {
  switch (action.kind) {
    case 'shopping-check':
      await api.checkShopping(action.id, action.checked)
      return
    case 'shopping-add':
      await api.addShopping(action.name, action.category)
      return
    case 'supply-check':
      await api.checkSupply(action.id, action.checked)
      return
    case 'supply-add':
      await api.addSupply(action.name, action.category as SupplyCategory | undefined)
      return
  }
}

async function syncOfflineQueue() {
  const synced = await flushOfflineQueue(runOfflineAction)
  if (synced > 0) {
    queryClient.invalidateQueries({ queryKey: ['shopping'] })
    queryClient.invalidateQueries({ queryKey: ['supplies'] })
    showToast(`Zsynchronizowano ${plural(synced, 'zmianę', 'zmiany', 'zmian')} z trybu offline.`)
  }
}

window.addEventListener('online', () => { void syncOfflineQueue() })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine) void syncOfflineQueue()
})

// The queue replays only in the household it was written in, so it waits for /api/auth/me
// (useAuth's ['auth'] query) and re-checks whenever the signed-in account changes.
let lastOwner: string | null | undefined
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.query.queryKey[0] !== 'auth') return
  const me = event.query.state.data as AuthMe | undefined
  if (!me) return
  const owner = me.authenticated && me.household ? String(me.household.id) : null
  if (owner === lastOwner) return
  lastOwner = owner
  setOfflineQueueOwner(owner)
  if (owner !== null && navigator.onLine) void syncOfflineQueue()
})

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore registration errors */ })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
