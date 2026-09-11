import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { registerChatOpener } from './lib/chatBus'
import { showToast } from './lib/toastBus'
import { useIsMobile } from './lib/useIsMobile'
import { useAuth } from './api/hooks'
import { NavRail } from './components/NavRail'
import { ChatSidebar } from './components/ChatSidebar'
import { PendingCookModal } from './components/PendingCookModal'
import { ToastHost } from './components/ToastHost'
import { LoginPrompt } from './components/LoginPrompt'
import { Library } from './pages/Library'
import { RecipeDetail } from './pages/RecipeDetail'
import { Pantry } from './pages/Pantry'
import { Shopping } from './pages/Shopping'
import { Profile } from './pages/Profile'
import { AddRecipe } from './pages/AddRecipe'
import { Plan } from './pages/Plan'
import { Questionnaire } from './pages/Questionnaire'
import { Random } from './pages/Random'
import { History } from './pages/History'
import { Palabras } from './pages/Palabras'

export default function App() {
  const isMobile = useIsMobile()
  const { canEdit } = useAuth()
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => registerChatOpener(() => setChatOpen(true)), [])

  // Whitelist rejection lands back on "/?auth=denied" (see AuthEndpoints/Google setup).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'denied') {
      showToast('To konto Google nie ma dostępu do edycji. Poproś właściciela o dodanie adresu do listy.')
      params.delete('auth')
      const qs = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }, [])

  // Phone: content on top, bottom tab bar under it, no chat panel (desktop-only).
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        // 100% (via html/body/#root) not 100dvh: Chrome multiplies viewport
        // units by the root zoom (tokens.css), which made the shell 25%
        // taller than the screen on desktop.
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      {!isMobile && <NavRail chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)} />}

      <main
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehaviorY: 'contain',
          position: 'relative',
          // Clearance for the fixed bottom tab bar.
          paddingBottom: isMobile ? 'calc(64px + env(safe-area-inset-bottom))' : undefined,
        }}
      >
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/random" element={<Random />} />
          <Route path="/history" element={<History />} />
          <Route path="/recipe/:id" element={<RecipeDetail />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/shopping" element={<Shopping />} />
          <Route path="/shopping/dom" element={<Shopping />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/ankieta" element={<Questionnaire />} />
          <Route path="/add" element={<AddRecipe />} />
          <Route path="/palabras" element={canEdit ? <Palabras /> : <LoginPrompt title="Fiszki są częścią Twojej kuchni" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!isMobile && canEdit && chatOpen && <ChatSidebar onClose={() => setChatOpen(false)} />}
      {isMobile && <NavRail mobile chatOpen={false} onToggleChat={() => {}} />}
      <PendingCookModal />
      <ToastHost />
    </div>
  )
}
