import { Component, Suspense, lazy, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { registerChatOpener } from './lib/chatBus'
import { phoneSubPages } from './lib/navModel'
import { useIsMobile } from './lib/useIsMobile'
import { useScrollMemory } from './lib/useScrollMemory'
import { useAuth, useChatHealth } from './api/hooks'
import { Sidebar } from './components/Sidebar'
import { TabBar, TAB_BAR_HEIGHT } from './components/TabBar'
import { SectionNav } from './components/SectionNav'
import { PendingCookModal } from './components/PendingCookModal'
import { ToastHost } from './components/ToastHost'
import { UpdatePill } from './components/UpdatePill'
import { LoginNudge } from './components/LoginNudge'
import { SousFab } from './components/SousFab'
import { Button, sans } from './components/ui'
import { Library } from './pages/Library'
import { RecipeDetail } from './pages/RecipeDetail'
import { Pantry } from './pages/Pantry'
import { Shopping } from './pages/Shopping'
import { Random } from './pages/Random'
import { Blocked, Onboarding, Welcome } from './pages/Onboarding'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyNamed<T extends Record<string, ComponentType<any>>, K extends keyof T>(loader: () => Promise<T>, name: K) {
  return lazy(() => loader().then((m) => ({ default: m[name] })))
}

const ChatSidebar = lazyNamed(() => import('./components/ChatSidebar'), 'ChatSidebar')
const Profile = lazyNamed(() => import('./pages/Profile'), 'Profile')
const AddRecipe = lazyNamed(() => import('./pages/AddRecipe'), 'AddRecipe')
const EditRecipe = lazyNamed(() => import('./pages/EditRecipe'), 'EditRecipe')
const Plan = lazyNamed(() => import('./pages/Plan'), 'Plan')
const Goal = lazyNamed(() => import('./pages/Goal'), 'Goal')
const Questionnaire = lazyNamed(() => import('./pages/Questionnaire'), 'Questionnaire')
const History = lazyNamed(() => import('./pages/History'), 'History')
const Training = lazyNamed(() => import('./pages/Training'), 'Training')
const AdminPage = lazyNamed(() => import('./pages/admin/AdminPage'), 'AdminPage')
const SharedRecipePage = lazyNamed(() => import('./pages/SharedRecipePage'), 'SharedRecipePage')
const TwilightQuiz = lazyNamed(() => import('./zmierzch/TwilightQuiz'), 'TwilightQuiz')

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack)
  }
  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{ padding: '48px 24px', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 32 }}>Coś poszło nie tak</h1>
        <p style={{ margin: 0, font: sans(15), color: 'var(--text-2)', lineHeight: 1.5 }}>
          Widok napotkał nieoczekiwany błąd. Odświeżenie strony powinno pomóc.
        </p>
        <Button onClick={() => window.location.reload()}>Odśwież stronę</Button>
      </div>
    )
  }
}

const routeFallback = <div style={{ padding: '32px 24px', color: 'var(--text-3)', font: sans(14) }}>Ładowanie…</div>

export default function App() {
  const isMobile = useIsMobile()
  const { data: auth, isLoading: authLoading, canEdit } = useAuth()
  const { data: chatHealth } = useChatHealth()
  const [chatOpen, setChatOpen] = useState(false)
  const { pathname } = useLocation()
  // Recipe pages bring their own sticky action bar on phones (design screen 02).
  const showTabs = isMobile && !pathname.startsWith('/recipe/')
  const hasSectionNav = showTabs && !authLoading && phoneSubPages(pathname, canEdit) != null
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null)
  useScrollMemory(mainEl)

  useEffect(() => registerChatOpener(() => setChatOpen(true)), [])

  // Temporary public quiz trainer — outside the shell and the auth gates (src/zmierzch).
  if (pathname.startsWith('/zmierzch')) {
    return (
      <ErrorBoundary>
        <Suspense fallback={routeFallback}>
          <TwilightQuiz />
        </Suspense>
      </ErrorBoundary>
    )
  }

  // Shared recipe link (/s/:token): readable without signing in; signed-in members see it inside the app shell.
  if (pathname.startsWith('/s/') && !auth?.authenticated) {
    return (
      <ErrorBoundary>
        <Suspense fallback={routeFallback}>
          <Routes>
            <Route path="/s/:token" element={<SharedRecipePage />} />
          </Routes>
        </Suspense>
        <ToastHost />
      </ErrorBoundary>
    )
  }

  // Before the app: a Google account without a household redeems an invite code; with no
  // public household to browse, an anonymous visitor can only sign in.
  if (auth?.blocked) return <><Blocked /><ToastHost /></>
  if (auth?.needsOnboarding) return <><Onboarding /><ToastHost /></>
  if (auth && !auth.authenticated && !auth.signedIn && !auth.publicHousehold) return <Welcome />

  // Desktop: sidebar | content | Sous panel. Phone: content over a fixed tab bar; Sous is a full-screen sheet.
  return (
    <ErrorBoundary>
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
          ref={setMainEl}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehaviorY: 'contain',
            position: 'relative',
            // Safe top clearance for iOS standalone PWA pages that don't render SectionNav.
            paddingTop: isMobile && !hasSectionNav ? 'env(safe-area-inset-top)' : undefined,
            // Clearance for the fixed bottom tab bar.
            paddingBottom: showTabs ? `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` : undefined,
          }}
        >
          {showTabs && <SectionNav />}
          <Suspense fallback={routeFallback}>
            <Routes>
              <Route path="/" element={<Library />} />
              <Route path="/random" element={<Random />} />
              <Route path="/history" element={<History />} />
              <Route path="/recipe/:id" element={<RecipeDetail />} />
              <Route path="/recipe/:id/edit" element={<EditRecipe />} />
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
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/:tab" element={<AdminPage />} />
              <Route path="/s/:token" element={<SharedRecipePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>

        {canEdit && chatOpen && (
          <Suspense fallback={null}>
            <ChatSidebar fullscreen={isMobile} onClose={() => setChatOpen(false)} />
          </Suspense>
        )}
        {showTabs && <TabBar />}
        <PendingCookModal />
        <ToastHost />
        <UpdatePill />
        <LoginNudge />
        {showTabs && canEdit && chatHealth?.enabled && !chatOpen && <SousFab onOpen={() => setChatOpen(true)} />}
      </div>
    </ErrorBoundary>
  )
}
