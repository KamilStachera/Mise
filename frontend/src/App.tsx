import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { registerChatOpener } from './lib/chatBus'
import { useIsMobile } from './lib/useIsMobile'
import { useScrollMemory } from './lib/useScrollMemory'
import { useAuth, useChatHealth } from './api/hooks'
import { Sidebar } from './components/Sidebar'
import { TabBar, TAB_BAR_HEIGHT } from './components/TabBar'
import { ChatSidebar } from './components/ChatSidebar'
import { PendingCookModal } from './components/PendingCookModal'
import { ToastHost } from './components/ToastHost'
import { UpdatePill } from './components/UpdatePill'
import { LoginNudge } from './components/LoginNudge'
import { SousFab } from './components/SousFab'
import { Library } from './pages/Library'
import { RecipeDetail } from './pages/RecipeDetail'
import { Pantry } from './pages/Pantry'
import { Shopping } from './pages/Shopping'
import { Profile } from './pages/Profile'
import { AddRecipe } from './pages/AddRecipe'
import { Plan } from './pages/Plan'
import { Goal } from './pages/Goal'
import { Questionnaire } from './pages/Questionnaire'
import { Random } from './pages/Random'
import { History } from './pages/History'
import { Training } from './pages/Training'
import { Onboarding, Welcome } from './pages/Onboarding'

export default function App() {
  const isMobile = useIsMobile()
  const { data: auth, canEdit } = useAuth()
  const { data: chatHealth } = useChatHealth()
  const [chatOpen, setChatOpen] = useState(false)
  const { pathname } = useLocation()
  // Recipe pages bring their own sticky action bar on phones (design screen 02).
  const showTabs = isMobile && !pathname.startsWith('/recipe/')
  const mainRef = useRef<HTMLElement>(null)
  useScrollMemory(mainRef)

  useEffect(() => registerChatOpener(() => setChatOpen(true)), [])

  // Before the app: a Google account without a household redeems an invite code; with no
  // public household to browse, an anonymous visitor can only sign in.
  if (auth?.needsOnboarding) return <><Onboarding /><ToastHost /></>
  if (auth && !auth.authenticated && !auth.signedIn && !auth.publicHousehold) return <Welcome />

  // Desktop: sidebar | content | Sous panel. Phone: content over a fixed tab bar; Sous is a full-screen sheet.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      {!isMobile && <Sidebar chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)} />}

      <main
        ref={mainRef}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehaviorY: 'contain',
          position: 'relative',
          // Clearance for the fixed bottom tab bar.
          paddingBottom: showTabs ? `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` : undefined,
        }}
      >
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/random" element={<Random />} />
          <Route path="/history" element={<History />} />
          <Route path="/recipe/:id" element={<RecipeDetail />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/plan/dzien" element={<Plan />} />
          <Route path="/plan/tydzien" element={<Plan />} />
          <Route path="/plan/postepy" element={<Plan />} />
          <Route path="/plan/aktywnosc" element={<Plan />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/shopping" element={<Shopping />} />
          <Route path="/shopping/dom" element={<Shopping />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/ankieta" element={<Questionnaire />} />
          <Route path="/profile/cel" element={<Goal />} />
          <Route path="/add" element={<AddRecipe />} />
          <Route path="/trening" element={<Training />} />
          <Route path="/trening/dzis" element={<Training />} />
          <Route path="/trening/plan" element={<Training />} />
          <Route path="/trening/cwiczenia" element={<Training />} />
          <Route path="/trening/ankieta" element={<Training />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {canEdit && chatOpen && <ChatSidebar fullscreen={isMobile} onClose={() => setChatOpen(false)} />}
      {showTabs && <TabBar />}
      <PendingCookModal />
      <ToastHost />
      <UpdatePill />
      <LoginNudge />
      {showTabs && canEdit && chatHealth?.enabled && !chatOpen && <SousFab onOpen={() => setChatOpen(true)} />}
    </div>
  )
}
