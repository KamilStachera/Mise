import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { useChatHealth, useChatHistory, useRecipe } from '../api/hooks'
import { streamChat } from '../api/client'
import { registerPromptConsumer } from '../lib/chatBus'
import { plural } from '../lib/labels'
import { mono, sans } from './ui'

type Msg = { role: 'ai' | 'user'; content: string }

const QUICKS = [
  'Co mogę zrobić na dziś?',
  'Zaplanuj 3 obiady na tydzień',
  'Wykorzystaj udka z kurczaka',
  'Coś z frytkownicy',
]

/**
 * Sous — the in-app assistant. Desktop: a 360px panel beside the content.
 * Phones: a full-screen sheet. On a recipe page the conversation is scoped to
 * that recipe (the server appends it to the system prompt).
 */
export function ChatSidebar({ onClose, fullscreen = false }: { onClose: () => void; fullscreen?: boolean }) {
  const { data: health } = useChatHealth()
  const { data: history } = useChatHistory()
  const recipeId = useMatch('/recipe/:id')?.params.id
  const { data: recipe } = useRecipe(recipeId)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  // Prompt handed over via chatBus (e.g. the random view's "ask Sous" link);
  // held until the health check confirms chat is enabled.
  const [queued, setQueued] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const enabled = health?.enabled ?? false

  useEffect(() => {
    if (history) setMessages(history.map((m) => ({ role: m.role, content: m.content })))
  }, [history])

  useEffect(() => registerPromptConsumer(setQueued), [])

  useEffect(() => {
    if (queued && enabled && !typing) {
      setQueued(null)
      send(queued)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, enabled, typing])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, typing])

  const quicks = recipe
    ? [
        `Przelicz na ${plural(recipe.selectedServings * 2, 'porcję', 'porcje', 'porcji')}`,
        recipe.missing[0] ? `Czym zastąpić: ${recipe.missing[0]}?` : 'Co podać do tego?',
        recipe.usesAirFryer ? 'Ile to trwa we frytkownicy?' : 'Czy da się to zrobić we frytkownicy?',
      ]
    : QUICKS

  async function send(text: string) {
    if (!text.trim() || !enabled || typing) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text.trim() }, { role: 'ai', content: '' }])
    setTyping(true)
    try {
      await streamChat(
        text.trim(),
        (delta) => {
          setMessages((m) => {
            const next = [...m]
            next[next.length - 1] = { role: 'ai', content: next[next.length - 1].content + delta }
            return next
          })
        },
        undefined,
        recipeId,
      )
    } catch {
      // Keep whatever streamed before the failure instead of wiping it.
      setMessages((m) => {
        const next = [...m]
        const partial = next[next.length - 1].content
        next[next.length - 1] = {
          role: 'ai',
          content: partial
            ? `${partial}\n\n⚠️ Połączenie przerwane — odpowiedź może być niepełna.`
            : 'Przepraszam — coś poszło nie tak przy połączeniu z modelem.',
        }
        return next
      })
    } finally {
      setTyping(false)
    }
  }

  const panelStyle: CSSProperties = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 95, paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }
    : { flex: '0 0 360px', width: 360 }

  return (
    <aside style={{ ...panelStyle, background: 'var(--panel-bg)', color: 'var(--panel-text)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '22px 22px 18px', borderBottom: '1px solid var(--panel-border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 24, lineHeight: 1 }}>
            Sous<span style={{ fontStyle: 'italic', color: 'var(--accent-warm)' }}>.</span>
          </span>
          <span style={{ font: sans(12.5), color: 'var(--panel-text-2)' }}>zna Twoją spiżarnię i profil</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Zamknij"
          style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--panel-text)', cursor: 'pointer', fontSize: 13 }}
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: 22 }}>
        {recipe && (
          <span style={{ alignSelf: 'center', textAlign: 'center', font: mono(10.5, 500), letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--panel-text-2)' }}>
            O przepisie · {recipe.title}
          </span>
        )}

        {messages.map((m, i) => (
          <Bubble key={i} msg={m} />
        ))}

        {!enabled && <DisabledNote />}

        {typing && messages[messages.length - 1]?.content === '' && (
          <div style={{ alignSelf: 'flex-start', background: 'var(--ai-bubble)', borderRadius: '14px 14px 14px 4px', padding: '13px 16px', display: 'flex', gap: 5 }}>
            {[0, 0.2, 0.4].map((d) => (
              <span key={d} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--panel-text-2)', animation: `blink 1.2s infinite ${d}s` }} />
            ))}
          </div>
        )}

        {enabled && !typing && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {quicks.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--panel-text)', font: sans(13, 500), cursor: 'pointer', textAlign: 'left' }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 'none', padding: '16px 18px 20px', borderTop: '1px solid var(--panel-border)' }}>
        <div style={{ minHeight: 48, borderRadius: 12, background: 'var(--panel-card)', display: 'flex', alignItems: 'flex-end', gap: 8, padding: '6px 6px 6px 16px', opacity: enabled ? 1 : 0.55 }}>
          <textarea
            value={input}
            disabled={!enabled}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            rows={1}
            placeholder={!enabled ? 'Czat w aplikacji jest wyłączony' : recipe ? 'Zapytaj o przepis…' : 'Zapytaj Sous o obiad…'}
            style={{ flex: 1, alignSelf: 'center', border: 0, background: 'transparent', resize: 'none', font: sans(fullscreen ? 16 : 14.5), color: 'var(--panel-text)', lineHeight: 1.4, maxHeight: 96, padding: '6px 0' }}
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!enabled}
            aria-label="Wyślij"
            style={{ flex: '0 0 36px', width: 36, height: 36, borderRadius: 9, border: 0, background: 'var(--accent)', color: '#fff', fontSize: 16, cursor: enabled ? 'pointer' : 'not-allowed' }}
          >
            ↑
          </button>
        </div>
      </div>
    </aside>
  )
}

function Bubble({ msg }: { msg: Msg }) {
  const isAi = msg.role === 'ai'
  if (isAi && !msg.content) return null
  return (
    <div
      style={{
        alignSelf: isAi ? 'flex-start' : 'flex-end',
        maxWidth: isAi ? '90%' : '84%',
        padding: isAi ? '13px 15px' : '11px 14px',
        borderRadius: isAi ? '14px 14px 14px 4px' : '14px 14px 4px 14px',
        background: isAi ? 'var(--ai-bubble)' : 'var(--user-bubble)',
        font: sans(14.5),
        lineHeight: isAi ? 1.5 : 1.45,
        whiteSpace: 'pre-wrap',
        animation: 'msgIn .2s ease',
      }}
    >
      {msg.content}
    </div>
  )
}

function DisabledNote() {
  const nav = useNavigate()
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '94%', display: 'flex', flexDirection: 'column', gap: 10, padding: '13px 15px', borderRadius: '14px 14px 14px 4px', background: 'var(--ai-bubble)' }}>
      <span style={{ font: sans(14.5, 600) }}>Czat w aplikacji jest wyłączony</span>
      <span style={{ font: sans(14), lineHeight: 1.5, color: 'var(--panel-text-2)' }}>
        Główna droga do AI to folder <strong style={{ color: 'var(--panel-text)' }}>./context</strong> — otwórz go w{' '}
        <strong style={{ color: 'var(--panel-text)' }}>Codex</strong> lub <strong style={{ color: 'var(--panel-text)' }}>Claude Code</strong> (w ramach Twojej
        subskrypcji). Zawiera Twoją książkę, spiżarnię i przepisy.
      </span>
      <button
        type="button"
        onClick={() => nav('/profile')}
        style={{ alignSelf: 'flex-start', font: sans(13, 600), color: 'var(--accent-warm)', background: 'transparent', border: 0, cursor: 'pointer', padding: 0 }}
      >
        Profil → Synchronizuj z ./context →
      </button>
      <span style={{ font: sans(12.5), color: 'var(--panel-text-2)', lineHeight: 1.5 }}>
        Aby włączyć ten panel, ustaw <code style={{ color: 'var(--accent-warm)' }}>AI_PROVIDER</code> i klucz w <code style={{ color: 'var(--accent-warm)' }}>.env</code>.
      </span>
    </div>
  )
}
