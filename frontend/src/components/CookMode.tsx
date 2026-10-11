import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Ingredient } from '../api/client'
import { parseStepDurations, formatCountdown } from '../lib/durations'
import { plural } from '../lib/labels'
import { ingredientsInStep, stepTitle } from '../lib/stepIngredients'
import { useIsMobile } from '../lib/useIsMobile'
import { mono, sans } from './ui'

/**
 * Full-screen "Gotuj krok po kroku" overlay (dark). Desktop: ingredient
 * checklist | the step | timer + all steps. Phone: one column with the
 * buttons at the bottom. Arrow keys change steps, space starts/pauses the
 * timer, Esc closes; the screen stays awake while open.
 */
export function CookMode({ title, steps, ingredients, servings, onClose }: {
  title: string
  steps: string[]
  ingredients: Ingredient[]
  servings: number
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const wide = useMedia('(min-width: 1100px)')
  const [step, setStep] = useState(0)
  const [checked, setChecked] = useState<Set<number>>(() => new Set())
  const isFirst = step === 0
  const isLast = step === steps.length - 1
  const timer = useTimer(parseStepDurations(steps[step] ?? '')[0]?.seconds ?? 0, step)

  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), [])
  const next = useCallback(() => setStep((s) => Math.min(steps.length - 1, s + 1)), [steps.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
      if (e.key === ' ') {
        e.preventDefault()
        timer.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next, timer])

  useWakeLock()

  // Lock body scroll behind the overlay.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  const needed = ingredientsInStep(steps[step] ?? '', ingredients)
  const toggleIngredient = (i: number) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  const progress = (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: isMobile ? 5 : 6 }}>
      {steps.map((_, i) => (
        <span key={i} onClick={() => setStep(i)} style={{ height: 3, borderRadius: 2, background: i <= step ? 'var(--cook-progress)' : 'var(--cook-line)', cursor: 'pointer' }} />
      ))}
    </div>
  )

  const closeBtn = (
    <button type="button" onClick={onClose} title="Zakończ (Esc)" style={{ height: 40, padding: isMobile ? '0 14px' : '0 16px', borderRadius: 999, border: '1px solid var(--cook-line)', background: 'transparent', color: 'var(--panel-text)', font: sans(isMobile ? 13 : 14, 600), cursor: 'pointer' }}>
      ✕ Zakończ
    </button>
  )

  const theStep = (
    <div key={step} style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20, animation: 'fadeUp .24s ease-out' }}>
      <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: isMobile ? 22 : 28, color: 'var(--accent-warm)' }}>{stepTitle(step)}</span>
      <p style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: isMobile ? 31 : wide ? 50 : 40, lineHeight: isMobile ? 1.18 : 1.12, letterSpacing: '-0.015em', textWrap: 'pretty' as never }}>{steps[step]}</p>
      {needed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isMobile && <Label>Potrzebne teraz</Label>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {needed.map((ing, i) => (
              <span key={i} style={{ padding: isMobile ? '8px 12px' : '9px 14px', borderRadius: 999, background: 'var(--cook-line-soft)', font: sans(isMobile ? 14 : 14.5, 500) }}>
                {ing.name}
                {ing.quantity && <span style={{ font: mono(12.5), color: 'var(--panel-text-2)', marginLeft: 8 }}>{ing.quantity}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const navButtons = (
    <div style={{ display: 'flex', gap: isMobile ? 10 : 12 }}>
      <button
        type="button"
        onClick={prev}
        disabled={isFirst}
        style={{ flex: isMobile ? 1 : '0 0 180px', height: 64, borderRadius: 16, border: '1px solid var(--cook-line)', background: 'transparent', color: 'var(--panel-text)', font: sans(16, 600), cursor: isFirst ? 'default' : 'pointer', opacity: isFirst ? 0.45 : 1 }}
      >
        ← Wstecz
      </button>
      <button
        type="button"
        onClick={isLast ? onClose : next}
        style={{ flex: isMobile ? 2 : 1, height: 64, borderRadius: 16, border: 0, background: 'var(--panel-text)', color: 'var(--text)', font: sans(16, 600), cursor: 'pointer' }}
      >
        {isLast ? 'Gotowe ✓' : isMobile ? 'Dalej →' : `Dalej: krok ${step + 2} →`}
      </button>
    </div>
  )

  const shell: CSSProperties = { position: 'fixed', inset: 0, zIndex: 100, background: 'var(--cook-bg)', color: 'var(--panel-text)', display: 'flex', flexDirection: 'column', animation: 'fadeUp .22s ease-out' }

  if (isMobile || !wide) {
    return (
      <div style={shell}>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 22, padding: isMobile ? 'calc(14px + env(safe-area-inset-top)) 22px 16px' : '28px 40px 16px', maxWidth: 760, width: '100%', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {closeBtn}
            <span style={{ font: mono(13, 500), color: 'var(--panel-text-2)' }}>{step + 1} / {steps.length}</span>
          </div>
          {progress}
          <Label size={12}>{title}</Label>
          {theStep}
          <TimerRow timer={timer} />
          <details style={{ borderTop: '1px solid var(--cook-line)', paddingTop: 12 }}>
            <summary style={{ cursor: 'pointer', font: sans(14, 600), color: 'var(--panel-text-2)', listStyle: 'none' }}>
              Wszystkie składniki · {plural(servings, 'porcja', 'porcje', 'porcji')} ▾
            </summary>
            <IngredientChecklist ingredients={ingredients} checked={checked} onToggle={toggleIngredient} />
          </details>
        </div>
        <div style={{ flex: 'none', padding: '14px 16px calc(16px + env(safe-area-inset-bottom))', maxWidth: 760, width: '100%', margin: '0 auto' }}>{navButtons}</div>
      </div>
    )
  }

  return (
    <div style={shell}>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 16, padding: '22px 40px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          {closeBtn}
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{ font: mono(14, 500), color: 'var(--panel-text-2)' }}>krok {step + 1} z {steps.length}</span>
        </div>
        {progress}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '280px minmax(0,1fr) 300px', gap: 56, padding: '40px 40px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
          <Label rule>Składniki · {plural(servings, 'porcja', 'porcje', 'porcji')}</Label>
          <IngredientChecklist ingredients={ingredients} checked={checked} onToggle={toggleIngredient} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 32, paddingBottom: 40, minHeight: 0, overflowY: 'auto' }}>
          {theStep}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {navButtons}
            <span style={{ font: mono(12), color: 'var(--cook-muted)' }}>Strzałki ← → zmieniają krok · spacja uruchamia minutnik</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28, minHeight: 0, overflowY: 'auto', paddingBottom: 40 }}>
          <TimerCard timer={timer} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Label rule>Wszystkie kroki</Label>
            {steps.map((s, i) => {
              const current = i === step
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: current ? '12px 0 12px 12px' : '12px 0',
                    border: 0,
                    borderBottom: i < steps.length - 1 ? '1px solid var(--cook-line-soft)' : 0,
                    boxShadow: current ? 'inset 3px 0 0 var(--cook-progress)' : undefined,
                    background: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    font: sans(14),
                    lineHeight: 1.45,
                    color: current ? 'var(--panel-text)' : i < step ? 'var(--cook-muted)' : 'var(--panel-text-2)',
                  }}
                >
                  <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 18, lineHeight: 1.1, color: current ? 'var(--accent-warm)' : undefined }}>{i + 1}</span>
                  <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function Label({ children, rule, size = 11 }: { children: ReactNode; rule?: boolean; size?: number }) {
  return (
    <span style={{ font: mono(size, 500), letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--panel-text-2)', paddingBottom: rule ? 10 : 0, borderBottom: rule ? '1px solid var(--cook-line)' : undefined }}>
      {children}
    </span>
  )
}

function IngredientChecklist({ ingredients, checked, onToggle }: { ingredients: Ingredient[]; checked: Set<number>; onToggle: (i: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {ingredients.map((ing, i) => {
        const done = checked.has(i)
        const followsAlternative = Boolean(ing.alternativeGroup && ingredients[i - 1]?.alternativeGroup === ing.alternativeGroup)
        return (
          <button
            key={i}
            type="button"
            onClick={() => onToggle(i)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', border: 0, borderBottom: '1px solid var(--cook-line-soft)', background: 'transparent', cursor: 'pointer', textAlign: 'left', font: sans(15), color: done ? 'var(--cook-muted)' : 'var(--panel-text)' }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                flex: '0 0 20px',
                borderRadius: 6,
                border: done ? 0 : '1.5px solid var(--panel-text-2)',
                background: done ? 'var(--sage)' : 'transparent',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
              }}
            >
              {done && '✓'}
            </span>
            <span style={{ flex: 1, minWidth: 0, textDecoration: done ? 'line-through' : undefined }}>
              {followsAlternative && <span style={{ font: mono(11.5), marginRight: 6 }}>lub</span>}
              {ing.name}
            </span>
            {ing.quantity && <span style={{ font: mono(12.5), color: done ? undefined : 'var(--panel-text-2)', textAlign: 'right' }}>{ing.quantity}</span>}
          </button>
        )
      })}
    </div>
  )
}

type Timer = ReturnType<typeof useTimer>

/** Countdown seeded from the step's first duration; resets when the step changes. */
function useTimer(stepSeconds: number, stepKey: number) {
  const [total, setTotal] = useState(stepSeconds)
  const [left, setLeft] = useState(stepSeconds)
  const [state, setState] = useState<'idle' | 'running' | 'paused' | 'done'>('idle')
  const endsAt = useRef(0)

  useEffect(() => {
    setTotal(stepSeconds)
    setLeft(stepSeconds)
    setState('idle')
  }, [stepKey, stepSeconds])

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

  const toggle = useCallback(() => {
    setState((s) => {
      if (s === 'running') return 'paused'
      if (s === 'done') {
        setLeft(total)
        return 'idle'
      }
      if (left <= 0) return s
      endsAt.current = Date.now() + left * 1000
      return 'running'
    })
  }, [left, total])

  const addMinute = useCallback(() => {
    if (state === 'running') endsAt.current += 60_000
    setLeft((l) => l + 60)
    setTotal((t) => t + 60)
    if (state === 'done') setState('idle')
  }, [state])

  return { left, state, toggle, addMinute, hasPreset: stepSeconds > 0 }
}

function timerButtonLabel(t: Timer): string {
  return t.state === 'running' ? 'Pauza' : t.state === 'paused' ? 'Wznów' : t.state === 'done' ? 'Od nowa' : 'Start'
}

function TimerCard({ timer }: { timer: Timer }) {
  const done = timer.state === 'done'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, borderRadius: 16, background: 'var(--cook-card)', animation: done ? 'timerPulse 1.1s ease-in-out infinite' : undefined }}>
      <Label>{done ? 'Czas minął!' : 'Minutnik'}</Label>
      <span style={{ font: mono(64, 500), letterSpacing: '-0.03em', lineHeight: 1, color: done ? 'var(--accent-warm)' : undefined }}>{formatCountdown(timer.left)}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={timer.toggle} disabled={timer.left <= 0 && timer.state !== 'done'} style={{ flex: 1, height: 46, borderRadius: 12, border: 0, background: 'var(--accent)', color: '#fff', font: sans(15, 600), cursor: 'pointer', opacity: timer.left <= 0 && timer.state !== 'done' ? 0.45 : 1 }}>
          {timerButtonLabel(timer)}
        </button>
        <button type="button" onClick={timer.addMinute} style={{ height: 46, padding: '0 14px', borderRadius: 12, border: '1px solid var(--cook-line)', background: 'transparent', color: 'var(--panel-text)', font: sans(14, 600), cursor: 'pointer' }}>
          +1 min
        </button>
      </div>
      {!timer.hasPreset && <span style={{ font: sans(12.5), color: 'var(--cook-muted)' }}>Ten krok nie podaje czasu — ustaw własny.</span>}
    </div>
  )
}

function TimerRow({ timer }: { timer: Timer }) {
  const done = timer.state === 'done'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 0', borderTop: '1px solid var(--cook-line)', borderBottom: '1px solid var(--cook-line)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: mono(40, 500), letterSpacing: '-0.02em', color: done ? 'var(--accent-warm)' : undefined }}>{formatCountdown(timer.left)}</span>
        <span style={{ font: sans(13), color: 'var(--panel-text-2)' }}>{done ? 'czas minął!' : timer.hasPreset ? 'minutnik z przepisu' : 'minutnik'}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={timer.addMinute} style={{ height: 48, padding: '0 14px', borderRadius: 999, border: '1px solid var(--cook-line)', background: 'transparent', color: 'var(--panel-text)', font: sans(14, 600), cursor: 'pointer' }}>
          +1
        </button>
        <button type="button" onClick={timer.toggle} disabled={timer.left <= 0 && !done} style={{ height: 48, padding: '0 20px', borderRadius: 999, border: 0, background: 'var(--accent)', color: '#fff', font: sans(15, 600), cursor: 'pointer', opacity: timer.left <= 0 && !done ? 0.45 : 1 }}>
          {timerButtonLabel(timer)}
        </button>
      </div>
    </div>
  )
}

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatch(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return match
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
    /* no audio available — the pulsing card is the fallback cue */
  }
}
