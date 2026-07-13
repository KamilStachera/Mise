import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Ingredient } from '../api/client'
import { parseStepDurations, formatCountdown } from '../lib/durations'
import { ClockIcon, CloseIcon } from './icons'

/**
 * Full-screen "Tryb gotowania" overlay: one step at a time in large serif type,
 * prev/next (buttons + arrow keys), a collapsible ingredient list, tappable
 * countdown timers parsed from the step text, and a screen wake lock while open.
 * Espresso palette — the same family as the chat panel, easy on the eyes at the stove.
 */
export function CookMode({ title, steps, ingredients, onClose }: {
  title: string
  steps: string[]
  ingredients: Ingredient[]
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const [showIngredients, setShowIngredients] = useState(false)
  const canPrev = step > 0
  const canNext = step < steps.length - 1

  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), [])
  const next = useCallback(() => setStep((s) => Math.min(steps.length - 1, s + 1)), [steps.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next])

  useWakeLock()

  // Lock body scroll behind the overlay.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  const durations = parseStepDurations(steps[step] ?? '')

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'var(--panel-bg)',
        color: 'var(--panel-text)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeUp .22s ease-out',
      }}
    >
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: '1px solid var(--panel-border)' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ font: "700 10px 'Hanken Grotesk'", letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 3 }}>
            Tryb gotowania
          </div>
          <div style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
        </div>
        <button
          onClick={() => setShowIngredients((v) => !v)}
          style={{
            border: '1px solid ' + (showIngredients ? 'var(--accent)' : 'var(--panel-border)'),
            background: showIngredients ? 'rgba(192,85,45,.18)' : 'var(--panel-card)',
            color: showIngredients ? '#e8a583' : 'var(--panel-text-2)',
            borderRadius: 10,
            padding: '9px 14px',
            font: "600 12.5px 'Hanken Grotesk'",
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Składniki {showIngredients ? '▴' : '▾'}
        </button>
        <button
          onClick={onClose}
          title="Zamknij (Esc)"
          style={{ border: 'none', background: 'var(--panel-card)', color: 'var(--panel-text-2)', borderRadius: 10, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <CloseIcon />
        </button>
      </div>

      {showIngredients && (
        <div style={{ borderBottom: '1px solid var(--panel-border)', background: 'var(--panel-card)', padding: '13px 20px', maxHeight: '38vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 560, margin: '0 auto' }}>
            {ingredients.map((ing, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '7px 2px', borderBottom: i < ingredients.length - 1 ? '1px solid var(--panel-border)' : 'none' }}>
                <span style={{ flex: 1, fontSize: 15, color: 'var(--panel-text)' }}>{ing.name}</span>
                <span style={{ font: "500 13px 'Spline Sans Mono'", color: 'var(--panel-text-2)' }}>{ing.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* the step */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px 24px', textAlign: 'center' }}>
        <div key={step} style={{ maxWidth: 760, animation: 'fadeUp .24s ease-out' }}>
          <div style={{ font: "600 12px 'Spline Sans Mono'", letterSpacing: '.12em', color: 'var(--panel-text-2)', marginBottom: 22 }}>
            KROK {step + 1} Z {steps.length}
          </div>
          <p
            style={{
              fontFamily: "'Spectral', serif",
              fontWeight: 500,
              fontSize: 'clamp(24px, 3.6vw, 40px)',
              lineHeight: 1.42,
              margin: 0,
              color: 'var(--panel-text)',
            }}
          >
            {steps[step]}
          </p>
          {durations.length > 0 && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 30 }}>
              {durations.map((d, i) => (
                <TimerChip key={`${step}-${i}`} label={d.label} seconds={d.seconds} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* bottom bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px 18px', borderTop: '1px solid var(--panel-border)' }}>
        <button onClick={prev} disabled={!canPrev} style={navBtn(canPrev)}>
          ‹ Poprzedni
        </button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
          {steps.map((_, i) => (
            <span
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: i === step ? 22 : 7,
                height: 7,
                borderRadius: 4,
                background: i === step ? 'var(--accent)' : i < step ? 'rgba(192,85,45,.45)' : 'var(--panel-border)',
                cursor: 'pointer',
                transition: 'all .18s',
              }}
            />
          ))}
        </div>
        {canNext ? (
          <button onClick={next} style={{ ...navBtn(true), background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff' }}>
            Następny ›
          </button>
        ) : (
          <button onClick={onClose} style={{ ...navBtn(true), background: 'var(--sage)', border: '1px solid var(--sage)', color: '#fff' }}>
            ✓ Gotowe
          </button>
        )}
      </div>
    </div>
  )
}

function navBtn(enabled: boolean): CSSProperties {
  return {
    border: '1px solid var(--panel-border)',
    background: 'var(--panel-card)',
    color: enabled ? 'var(--panel-text)' : 'var(--panel-text-2)',
    opacity: enabled ? 1 : 0.4,
    borderRadius: 12,
    padding: '13px 22px',
    font: "600 15px 'Hanken Grotesk'",
    cursor: enabled ? 'pointer' : 'default',
    minWidth: 132,
  }
}

/**
 * Keeps the screen awake while cooking. Wake locks are auto-released when the
 * tab is hidden, so re-acquire on visibilitychange; no-op where unsupported.
 */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let disposed = false

    async function acquire() {
      try {
        lock = await navigator.wakeLock.request('screen')
        if (disposed) await lock.release()
      } catch {
        /* low battery / permission — cook mode still works, screen may dim */
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      lock?.release().catch(() => {})
    }
  }, [])
}

type TimerState = 'idle' | 'running' | 'done'

/** Tappable "smaż 10 minut" chip → countdown → gentle chime + pulse when done. */
function TimerChip({ label, seconds }: { label: string; seconds: number }) {
  const [state, setState] = useState<TimerState>('idle')
  const [left, setLeft] = useState(seconds)
  const endsAt = useRef(0)

  useEffect(() => {
    if (state !== 'running') return
    const tick = window.setInterval(() => {
      const remaining = Math.round((endsAt.current - Date.now()) / 1000)
      if (remaining <= 0) {
        setLeft(0)
        setState('done')
        chime()
      } else {
        setLeft(remaining)
      }
    }, 250)
    return () => window.clearInterval(tick)
  }, [state])

  function onClick() {
    if (state === 'idle') {
      endsAt.current = Date.now() + seconds * 1000
      setLeft(seconds)
      setState('running')
    } else {
      setState('idle')
      setLeft(seconds)
    }
  }

  const palette: Record<TimerState, { border: string; bg: string; col: string }> = {
    idle: { border: 'var(--panel-border)', bg: 'var(--panel-card)', col: 'var(--panel-text)' },
    running: { border: 'var(--accent)', bg: 'rgba(192,85,45,.18)', col: '#e8a583' },
    done: { border: 'var(--gold)', bg: 'rgba(189,139,44,.22)', col: '#e5bd6e' },
  }
  const c = palette[state]

  return (
    <button
      onClick={onClick}
      title={state === 'idle' ? 'Włącz minutnik' : 'Zatrzymaj minutnik'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.col,
        borderRadius: 22,
        padding: '11px 19px',
        font: "600 15px 'Hanken Grotesk'",
        cursor: 'pointer',
        transition: 'all .15s',
        animation: state === 'done' ? 'timerPulse 1.1s ease-in-out infinite' : 'none',
      }}
    >
      <ClockIcon size={16} />
      {state === 'idle' && <>{label}</>}
      {state === 'running' && <span style={{ font: "600 16px 'Spline Sans Mono'" }}>{formatCountdown(left)}</span>}
      {state === 'done' && <>Czas minął! ✕</>}
    </button>
  )
}

/** Three soft sine notes — audible over kitchen noise without being an alarm. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const notes = [880, 1108.7, 1318.5]
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.45
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.22, t + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.45)
    })
    window.setTimeout(() => ctx.close(), 2200)
  } catch {
    /* no audio available — the pulsing chip is the fallback cue */
  }
}
