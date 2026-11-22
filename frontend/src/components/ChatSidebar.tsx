import { useEffect, useRef, useState, type CSSProperties, type ClipboardEvent } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useChatHealth, useChatHistory, useRecipe } from '../api/hooks'
import { ApiError, api, streamChat, type ChatImageInfo, type ImportDocumentInfo } from '../api/client'
import { registerPromptConsumer } from '../lib/chatBus'
import { IMAGE_ACCEPT } from '../lib/images'
import { plural } from '../lib/labels'
import { showToast } from '../lib/toastBus'
import { mono, sans } from './ui'

type Msg = { role: 'ai' | 'user'; content: string; previews?: string[] }
type AttachedPhoto = ChatImageInfo & { previewUrl: string }

const MAX_PHOTOS = 3

const QUICKS = [
  'Co mogę zrobić na dziś?',
  'Zaplanuj 3 obiady na tydzień',
  'Wykorzystaj udka z kurczaka',
  'Coś z frytkownicy',
]

const PHOTO_QUICKS = [
  'Rozlicz paragon',
  'Zaktualizuj stan lodówki',
  'Policz kcal z tego talerza',
  'Zapisz przepis z tego zdjęcia',
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
  // What the agent is doing while it hasn't answered yet (Codex: „Sprawdzam spiżarnię…”).
  const [status, setStatus] = useState<string | null>(null)
  const qc = useQueryClient()
  // Prompt handed over via chatBus (e.g. the random view's "ask Sous" link);
  // held until the health check confirms chat is enabled.
  const [queued, setQueued] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // A PDF and/or up to 3 photos waiting to go out with the next message.
  const [attachment, setAttachment] = useState<ImportDocumentInfo | null>(null)
  const [photos, setPhotos] = useState<AttachedPhoto[]>([])
  const [uploading, setUploading] = useState<'pdf' | 'photo' | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const previewUrlsRef = useRef<string[]>([])

  const enabled = health?.enabled ?? false

  useEffect(() => () => {
    abortRef.current?.abort()
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url)
    previewUrlsRef.current = []
  }, [])

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

  const quicks = photos.length > 0
    ? PHOTO_QUICKS
    : recipe
      ? [
          `Przelicz na ${plural(recipe.selectedServings * 2, 'porcję', 'porcje', 'porcji')}`,
          recipe.missing[0] ? `Czym zastąpić: ${recipe.missing[0]}?` : 'Co podać do tego?',
          recipe.usesAirFryer ? 'Ile to trwa we frytkownicy?' : 'Czy da się to zrobić we frytkownicy?',
        ]
      : QUICKS

  async function attach(file: File | undefined) {
    if (!file) return
    setUploadError(null)
    setUploading('pdf')
    try {
      setAttachment(await api.uploadImportDocument(file))
    } catch (e) {
      setUploadError(e instanceof ApiError && e.detail ? e.detail : 'Nie udało się wgrać PDF-a.')
    } finally {
      setUploading(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function attachPhotos(fileList: FileList | File[] | null) {
    if (!fileList || fileList.length === 0) return
    const remaining = MAX_PHOTOS - photos.length
    if (remaining <= 0) {
      setUploadError(`Możesz załączyć maks. ${MAX_PHOTOS} zdjęcia naraz.`)
      return
    }
    const picked = Array.from(fileList).slice(0, remaining)
    setUploadError(null)
    setUploading('photo')
    try {
      const uploaded: AttachedPhoto[] = []
      for (const file of picked) {
        const info = await api.uploadChatImage(file)
        const previewUrl = URL.createObjectURL(file)
        previewUrlsRef.current.push(previewUrl)
        uploaded.push({ ...info, previewUrl })
      }
      setPhotos((prev) => [...prev, ...uploaded].slice(0, MAX_PHOTOS))
    } catch (e) {
      setUploadError(e instanceof ApiError && e.detail ? e.detail : 'Nie udało się wgrać zdjęcia (JPG/PNG/WebP, maks. 5 MB).')
    } finally {
      setUploading(null)
      if (photoRef.current) photoRef.current.value = ''
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target) {
        URL.revokeObjectURL(target.previewUrl)
        previewUrlsRef.current = previewUrlsRef.current.filter((u) => u !== target.previewUrl)
      }
      return prev.filter((p) => p.id !== id)
    })
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!enabled || typing || uploading) return
    const files: File[] = []
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      void attachPhotos(files)
    }
  }

  async function send(text: string) {
    const doc = attachment
    const imgs = photos
    if ((!text.trim() && !doc && imgs.length === 0) || !enabled || typing || uploading) return
    // Mirrors what the server stores, so the history reload shows the same bubble.
    const defaultText = imgs.length > 0
      ? (imgs.length === 1 ? 'Przeanalizuj załączone zdjęcie.' : 'Przeanalizuj załączone zdjęcia.')
      : 'Przejrzyj załączony PDF.'
    const shownParts = [text.trim() || defaultText]
    if (doc) shownParts.push(`PDF: ${doc.name}`)
    if (imgs.length > 0) shownParts.push(`${imgs.length === 1 ? 'Zdjęcie' : 'Zdjęcia'}: ${imgs.map((i) => i.name).join(', ')}`)
    const shown = shownParts.join('\n')
    const sentPreviews = imgs.map((i) => i.previewUrl)
    setInput('')
    setAttachment(null)
    setPhotos([])
    setUploadError(null)
    setMessages((m) => [
      ...m,
      { role: 'user', content: shown, previews: sentPreviews.length > 0 ? sentPreviews : undefined },
      { role: 'ai', content: '' },
    ])
    setTyping(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
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
        ctrl.signal,
        recipeId,
        setStatus,
        doc?.id,
        imgs.length > 0 ? imgs.map((i) => i.id) : undefined,
      )
      // Sous may have logged food, planned meals or edited lists — refresh everything including chatHistory.
      qc.invalidateQueries()
    } catch (e) {
      if (ctrl.signal.aborted) return
      if (e instanceof ApiError && e.status === 401) {
        qc.invalidateQueries({ queryKey: ['auth'] })
      }
      const errMsg = e instanceof ApiError && e.detail ? e.detail : null
      // Keep whatever streamed before the failure instead of wiping it.
      setMessages((m) => {
        const next = [...m]
        const partial = next[next.length - 1].content
        next[next.length - 1] = {
          role: 'ai',
          content: partial
            ? `${partial}\n\n⚠️ ${errMsg ?? 'Połączenie przerwane — odpowiedź może być niepełna.'}`
            : (errMsg ?? 'Przepraszam — coś poszło nie tak przy połączeniu z modelem.'),
        }
        return next
      })
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
      setTyping(false)
      setStatus(null)
    }
  }

  async function reset() {
    if (typing || messages.length === 0 || !confirm('Zacząć nową rozmowę? Obecna zniknie.')) return
    try {
      await api.resetChat()
      setMessages([])
      qc.invalidateQueries({ queryKey: ['chatHistory'] })
    } catch {
      showToast('Nie udało się wyczyścić rozmowy.')
    }
  }

  function handleClose() {
    abortRef.current?.abort()
    onClose()
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {enabled && messages.length > 0 && (
            <button
              type="button"
              onClick={reset}
              disabled={typing}
              style={{ height: 34, padding: '0 12px', borderRadius: 999, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--panel-text-2)', font: sans(12.5, 500), whiteSpace: 'nowrap', cursor: typing ? 'default' : 'pointer' }}
            >
              Nowa rozmowa
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            title="Zamknij"
            style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--panel-text)', cursor: 'pointer', fontSize: 13 }}
          >
            ✕
          </button>
        </span>
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
          <div style={{ alignSelf: 'flex-start', background: 'var(--ai-bubble)', borderRadius: '14px 14px 14px 4px', padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 5 }}>
            {[0, 0.2, 0.4].map((d) => (
              <span key={d} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--panel-text-2)', animation: `blink 1.2s infinite ${d}s` }} />
            ))}
            {status && <span style={{ marginLeft: 8, font: sans(13), color: 'var(--panel-text-2)' }}>{status}</span>}
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
        {(attachment || photos.length > 0 || uploading || uploadError) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            {photos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {photos.map((p) => (
                  <div key={p.id} style={{ position: 'relative', width: 48, height: 48, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--panel-border)' }}>
                    <img src={p.previewUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <button
                      type="button"
                      onClick={() => removePhoto(p.id)}
                      aria-label={`Usuń ${p.name}`}
                      style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 0, background: 'rgba(0,0,0,.68)', color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {(attachment || uploading || uploadError) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: sans(13), color: uploadError ? 'var(--accent-warm)' : 'var(--panel-text-2)' }}>
                {uploading === 'pdf' && <span>Wgrywam PDF…</span>}
                {uploading === 'photo' && <span>Wgrywam zdjęcie…</span>}
                {uploadError && <span>{uploadError}</span>}
                {attachment && (
                  <>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--panel-text)' }}>
                      📎 {attachment.name}
                    </span>
                    <span style={{ flex: 'none', font: mono(11.5) }}>
                      {attachment.looksScanned ? 'skan — bez tekstu' : plural(attachment.pageCount, 'strona', 'strony', 'stron')}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      aria-label="Usuń załącznik"
                      style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--panel-text-2)', cursor: 'pointer', padding: '0 4px', fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => attach(e.target.files?.[0])} />
        <input ref={photoRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => attachPhotos(e.target.files)} />
        <div style={{ minHeight: 48, borderRadius: 12, background: 'var(--panel-card)', display: 'flex', alignItems: 'flex-end', gap: 6, padding: '6px 6px 6px 8px', opacity: enabled ? 1 : 0.55 }}>
          <button
            type="button"
            onClick={() => photoRef.current?.click()}
            disabled={!enabled || typing || Boolean(uploading) || photos.length >= MAX_PHOTOS}
            title="Dodaj zdjęcie (paragon, lodówka, talerz, przepis)"
            aria-label="Dodaj zdjęcie"
            style={{ flex: '0 0 auto', height: 36, padding: '0 8px', borderRadius: 9, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--panel-text-2)', font: mono(10.5, 600), letterSpacing: '.06em', cursor: enabled && !typing && photos.length < MAX_PHOTOS ? 'pointer' : 'not-allowed' }}
          >
            FOTO
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!enabled || typing || Boolean(uploading)}
            title="Dodaj PDF z przepisami"
            aria-label="Dodaj PDF z przepisami"
            style={{ flex: '0 0 auto', height: 36, padding: '0 7px', borderRadius: 9, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--panel-text-2)', font: mono(10.5, 500), letterSpacing: '.06em', cursor: enabled && !typing ? 'pointer' : 'not-allowed' }}
          >
            PDF
          </button>
          <textarea
            value={input}
            disabled={!enabled}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            rows={1}
            placeholder={!enabled ? 'Czat w aplikacji jest wyłączony' : photos.length > 0 ? 'Co zrobić z tym zdjęciem?' : recipe ? 'Zapytaj o przepis…' : attachment ? 'Co zrobić z tym PDF-em?' : 'Pytanie, zdjęcie lub link…'}
            style={{ flex: 1, alignSelf: 'center', border: 0, background: 'transparent', resize: 'none', font: sans(fullscreen ? 16 : 14.5), color: 'var(--panel-text)', lineHeight: 1.4, maxHeight: 96, padding: '6px 0' }}
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!enabled || typing || Boolean(uploading)}
            aria-label="Wyślij"
            style={{ flex: '0 0 36px', width: 36, height: 36, borderRadius: 9, border: 0, background: 'var(--accent)', color: '#fff', fontSize: 16, cursor: enabled && !typing && !uploading ? 'pointer' : 'not-allowed', opacity: enabled && !typing && !uploading ? 1 : 0.5 }}
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
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {msg.previews && msg.previews.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {msg.previews.map((url, idx) => (
            <img key={idx} src={url} alt="" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
          ))}
        </div>
      )}
      <span>{msg.content}</span>
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
