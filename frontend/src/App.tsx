import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { registerChatOpener } from './lib/chatBus'
import { NavRail } from './components/NavRail'
import { ChatSidebar } from './components/ChatSidebar'
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

export default function App() {
  const [chatOpen, setChatOpen] = useState(true)

  useEffect(() => registerChatOpener(() => setChatOpen(true)), [])

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      <NavRail chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)} />

      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative' }}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/random" element={<Random />} />
          <Route path="/history" element={<History />} />
          <Route path="/recipe/:id" element={<RecipeDetail />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/shopping" element={<Shopping />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/ankieta" element={<Questionnaire />} />
          <Route path="/add" element={<AddRecipe />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {chatOpen && <ChatSidebar onClose={() => setChatOpen(false)} />}
    </div>
  )
}
