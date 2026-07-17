import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Ingredient } from '../api/client'
import { parseStepDurations, formatCountdown } from '../lib/durations'
import { statusColor } from '../lib/labels'
import { ingredientDetailText } from '../lib/ingredients'
import { BackIcon, ChevronRight, ClockIcon, CloseIcon } from './icons'

/**
 * Full-screen "Gotuj krok po kroku" overlay: one step at a time in large serif
 * type, segment progress bar, prev/next (buttons + arrow keys), a collapsible
 * ingredient list with pantry-status dots, tappable countdown timers parsed
 * from the step text, and a screen wake lock while open.
 */
export function CookMode({ title, steps, ingredients, onClose }: {
  title: string
  steps: string[]
  ingredients: Ingredient[]
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const [showIngredients, setShowIngredients] = useState(false)
  const isFirst = step === 0
  const isLast = step === steps.length - 1

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
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg)', display: 'flex', flexDirection: 'column', animation: 'fadeUp .22s ease-out' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <button
          onClick={onClose}
          title="Zamknij (Esc)"
          style={{ width: 44, height: 44, flex: '0 0 44px', border: 'none', background: 'transparent', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}
        >
          <CloseIcon size={21} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Spectral', serif", fontWeight: 600, fontSize: 15.5, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          <div style={{ font: "500 12px 'Hanken Grotesk'", color: 'var(--text-3)' }}>
            Krok {step + 1} z {steps.length}
          </div>
        </div>
        <button
          onClick={() => setShowIngredients((v) => !v)}
          style={{
            border: '1px solid ' + (showIngredients ? 'var(--accent)' : 'var(--border-2)'),
            background: showIngredients ? 'var(--accent-soft)' : 'transparent',
            color: showIngredients ? 'var(--accent-deep)' : 'var(--text-2)',
            borderRadius: 11,
            padding: '10px 14px',
            font: "600 13px 'Hanken Grotesk'",
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          Składniki
        </button>
      </div>

      {/* progress segments */}
      <div style={{ display: 'flex', gap: 6, padding: '12px 18px 0' }}>
        {steps.map((_, i) => (
          <div
            key={i}
            onClick={() => setStep(i)}
            style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? 'var(--accent)' : 'var(--border-2)', cursor: 'pointer', transition: 'background .2s' }}
          />
        ))}
      </div>

      {showIngredients && (
        <div style={{ padding: '16px 18px 0', maxWidth: 640, margin: '0 auto', width: '100%' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '10px 14px', display: 'flex', flexDirection: 'column', maxHeight: '38vh', overflowY: 'auto' }}>
            {ingredients.map((ing, i) => {
              const detail = ingredientDetailText(ing.displayText, ing.quantity)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderBottom: i < ingredients.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ flex: '0 0 9px', width: 9, height: 9, borderRadius: '50%', background: statusColor(ing.status) }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                    {ing.name}
                    {detail && <span style={{ display: 'block', marginTop: 2, fontSize: 11, fontWeight: 400, color: 'var(--text-3)' }}>{detail}</span>}
                  </span>
                  {ing.quantity && <span style={{ flex: '0 0 auto', font: "500 11.5px 'Spline Sans Mono'", color: 'var(--text-2)', textAlign: 'right' }}>{ing.quantity}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* the step */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '28px clamp(18px, 5vw, 48px)', textAlign: 'center' }}>
        <div key={step} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, animation: 'fadeUp .24s ease-out' }}>
          <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--surface)', border: '2px solid var(--accent)', color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 22px 'Spectral', serif" }}>
            {step + 1}
          </div>
          <p style={{ margin: 0, maxWidth: '26ch', fontFamily: "'Spectral', serif", fontWeight: 500, fontSize: 'clamp(22px, 4.5vw, 32px)', lineHeight: 1.45, color: 'var(--text)', textWrap: 'pretty' }}>
            {steps[step]}
          </p>
          {durations.length > 0 && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {durations.map((d, i) => (
                <TimerChip key={`${step}-${i}`} label={d.label} seconds={d.seconds} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* bottom bar */}
      <div style={{ display: 'flex', gap: 10, padding: '14px 16px calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border)', background: 'var(--surface)', maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <button
          onClick={prev}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            border: '1px solid var(--border-2)',
            background: 'var(--card)',
            color: isFirst ? 'var(--text-3)' : 'var(--text)',
            borderRadius: 14,
            padding: 16,
            font: "600 15px 'Hanken Grotesk'",
            cursor: isFirst ? 'default' : 'pointer',
            opacity: isFirst ? 0.55 : 1,
            minHeight: 54,
          }}
        >
          <BackIcon /> Wstecz
        </button>
        <button
          onClick={isLast ? onClose : next}
          style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 14, padding: 16, font: "700 15.5px 'Hanken Grotesk'", cursor: 'pointer', minHeight: 54, boxShadow: '0 6px 18px rgba(160,66,32,.26)' }}
        >
          {isLast ? 'Gotowe' : 'Dalej'} <ChevronRight size={17} />
        </button>
      </div>
    </div>
  )
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
    idle: { border: 'var(--border-2)', bg: 'var(--card)', col: 'var(--text)' },
    running: { border: 'var(--accent)', bg: 'var(--accent-soft)', col: 'var(--accent-deep)' },
    done: { border: 'var(--gold)', bg: 'rgba(189,139,44,.16)', col: 'var(--gold)' },
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
