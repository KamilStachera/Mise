import React from 'react'
import ReactDOM from 'react-dom/client'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ApiError } from './api/client'
import { showToast } from './lib/toastBus'
import './theme/tokens.css'

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
