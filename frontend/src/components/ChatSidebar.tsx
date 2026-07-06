import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatHealth, useChatHistory } from '../api/hooks'
import { streamChat } from '../api/client'
import { registerPromptConsumer } from '../lib/chatBus'
import { SparkleIcon, ExpandIcon, CloseIcon, SendIcon } from './icons'

type Msg = { role: 'ai' | 'user'; content: string }

const QUICKS = [
  'Co mogę zrobić na dziś?',
  'Zaplanuj 3 obiady na tydzień',
  'Wykorzystaj udka z kurczaka',
  'Coś z frytkownicy',
]

export function ChatSidebar({ onClose }: { onClose: () => void }) {
  const { data: health } = useChatHealth()
  const { data: history } = useChatHistory()
  const [expanded, setExpanded] = useState(false)
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

  async function send(text: string) {
    if (!text.trim() || !enabled || typing) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text.trim() }, { role: 'ai', content: '' }])
    setTyping(true)
    try {
      await streamChat(text.trim(), (delta) => {
        setMessages((m) => {
          const next = [...m]
          next[next.length - 1] = { role: 'ai', content: next[next.length - 1].content + delta }
          return next
        })
      })
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

  const panelStyle: CSSProperties = {
    flex: `0 0 ${expanded ? 620 : 392}px`,
    width: expanded ? 620 : 392,
    background: 'var(--panel-bg)',
    borderLeft: '1px solid var(--panel-border)',
    display: 'flex',
    flexDirection: 'column',
    transition: 'flex-basis .25s ease, width .25s ease',
  }

  return (
    <aside style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '17px 19px 15px', borderBottom: '1px solid var(--panel-border)' }}>
        <div style={{ width: 31, height: 31, borderRadius: 9, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 31px' }}>
          <SparkleIcon />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 16, color: 'var(--panel-text)', lineHeight: 1.1 }}>Sous</div>
          <div style={{ font: "500 11.5px 'Hanken Grotesk'", color: 'var(--sage)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sage)' }} />
            Zna Twoją spiżarnię i profil
          </div>
        </div>
        <IconBtn onClick={() => setExpanded((v) => !v)} title="Powiększ">
          <ExpandIcon />
        </IconBtn>
        <IconBtn onClick={onClose} title="Ukryj">
          <CloseIcon />
        </IconBtn>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 19px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map((m, i) => (
          <Bubble key={i} msg={m} />
        ))}

        {!enabled && <DisabledNote />}

        {typing && (
          <div style={{ alignSelf: 'flex-start', background: 'var(--ai-bubble)', border: '1px solid var(--panel-border)', borderRadius: '14px 14px 14px 4px', padding: '13px 16px', display: 'flex', gap: 5 }}>
            {[0, 0.2, 0.4].map((d) => (
              <span key={d} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--panel-text-2)', animation: `blink 1.2s infinite ${d}s` }} />
            ))}
          </div>
        )}
      </div>

      {enabled && (
        <div style={{ padding: '10px 16px 7px', display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {QUICKS.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-card)', color: 'var(--panel-text)', borderRadius: 20, padding: '7px 12px', font: "500 12px 'Hanken Grotesk'", cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: '8px 16px 17px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, background: 'var(--panel-card)', border: '1px solid var(--panel-border)', borderRadius: 14, padding: '8px 8px 8px 14px', opacity: enabled ? 1 : 0.55 }}>
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
            placeholder={enabled ? 'Zapytaj Sous o obiad…' : 'Czat w aplikacji jest wyłączony'}
            style={{ flex: 1, border: 'none', background: 'transparent', resize: 'none', font: "400 14px 'Hanken Grotesk'", color: 'var(--panel-text)', lineHeight: 1.4, maxHeight: 90 }}
          />
          <button
            onClick={() => send(input)}
            disabled={!enabled}
            style={{ flex: '0 0 34px', width: 34, height: 34, borderRadius: 10, border: 'none', background: 'var(--accent)', cursor: enabled ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </aside>
  )
}

function Bubble({ msg }: { msg: Msg }) {
  const isAi = msg.role === 'ai'
  return (
    <div style={{ alignSelf: isAi ? 'flex-start' : 'flex-end', maxWidth: '90%' }}>
      <div
        style={
          isAi
            ? { background: 'var(--ai-bubble)', border: '1px solid var(--panel-border)', borderRadius: '14px 14px 14px 4px', padding: '12px 15px', font: "400 14px 'Hanken Grotesk'", lineHeight: 1.5, color: 'var(--panel-text)', whiteSpace: 'pre-wrap' }
            : { background: 'var(--accent)', borderRadius: '14px 14px 4px 14px', padding: '12px 15px', font: "400 14px 'Hanken Grotesk'", lineHeight: 1.5, color: '#fff', whiteSpace: 'pre-wrap' }
        }
      >
        {msg.content || '…'}
      </div>
    </div>
  )
}

function DisabledNote() {
  const nav = useNavigate()
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '92%', background: 'var(--panel-card)', border: '1px solid var(--panel-border)', borderLeft: '3px solid var(--gold)', borderRadius: '0 12px 12px 0', padding: '13px 15px' }}>
      <div style={{ font: "600 12.5px 'Hanken Grotesk'", color: 'var(--panel-text)', marginBottom: 6 }}>Czat w aplikacji jest wyłączony</div>
      <div style={{ font: "400 13px 'Hanken Grotesk'", color: 'var(--panel-text-2)', lineHeight: 1.5 }}>
        Główna droga do AI to folder <strong style={{ color: 'var(--panel-text)' }}>./context</strong> — otwórz go w{' '}
        <strong style={{ color: 'var(--panel-text)' }}>Codex</strong> lub <strong style={{ color: 'var(--panel-text)' }}>Claude Code</strong> (w ramach Twojej
        subskrypcji). Zawiera Twoją książkę, spiżarnię i przepisy.
      </div>
      <button
        onClick={() => nav('/profile')}
        style={{ marginTop: 10, font: "600 12px 'Hanken Grotesk'", color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        Otwórz Profil → Synchronizuj z ./context →
      </button>
      <div style={{ font: "400 11.5px 'Hanken Grotesk'", color: 'var(--panel-text-2)', marginTop: 8, lineHeight: 1.5 }}>
        Aby włączyć ten panel, ustaw <code style={{ color: 'var(--gold)' }}>AI_PROVIDER</code> i klucz w <code style={{ color: 'var(--gold)' }}>.env</code>.
      </div>
    </div>
  )
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--panel-text-2)', padding: 5, borderRadius: 7, display: 'flex' }}>
      {children}
    </button>
  )
}
