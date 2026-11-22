import { useEffect, useRef, useState } from 'react'
import { formatTimerClock, remainingTimerSeconds } from '../../lib/trainingStats'
import { useIsMobile } from '../../lib/useIsMobile'
import { mono, sans } from '../ui'

export interface RestTimerState {
  endsAtMs: number
  totalSeconds: number
  label: string
}

const MUTE_KEY = 'mise.restTimerMuted'

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function playFinishChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const playTone = (freq: number, startOffset: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + startOffset)
      gain.gain.setValueAtTime(0.001, now + startOffset)
      gain.gain.exponentialRampToValueAtTime(0.18, now + startOffset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + startOffset)
      osc.stop(now + startOffset + dur + 0.02)
    }
    playTone(587.33, 0, 0.18)
    playTone(880, 0.2, 0.28)
    window.setTimeout(() => { ctx.close().catch(() => {}) }, 700)
  } catch {
    // Ignore autoplay / audio context restrictions gracefully.
  }
}

/**
 * Sticky bottom rest countdown banner. Driven strictly by wall-clock `endsAtMs` so switching tabs
 * or locking the phone screen never causes timer drift.
 */
export function RestTimerBar({ timer, onAdjust, onDismiss }: {
  timer: RestTimerState | null
  onAdjust: (deltaSeconds: number) => void
  onDismiss: () => void
}) {
  const isMobile = useIsMobile()
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [muted, setMuted] = useState(loadMuted)
  const [finishedLabel, setFinishedLabel] = useState<string | null>(null)
  const chimedEndsAt = useRef<number | null>(null)

  useEffect(() => {
    if (!timer) return
    setFinishedLabel(null)
    setNowMs(Date.now())
    const tick = () => setNowMs(Date.now())
    const id = window.setInterval(tick, 250)
    const onVis = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [timer])

  const remaining = timer ? remainingTimerSeconds(timer.endsAtMs, nowMs) : 0

  useEffect(() => {
    if (!timer || remaining > 0) return
    if (chimedEndsAt.current === timer.endsAtMs) return
    chimedEndsAt.current = timer.endsAtMs
    if (!muted) playFinishChime()
    try { navigator.vibrate?.([150, 80, 150]) } catch { /* unsupported */ }
    setFinishedLabel(timer.label)
    const hideId = window.setTimeout(() => {
      setFinishedLabel(null)
      onDismiss()
    }, 4500)
    return () => window.clearTimeout(hideId)
  }, [timer, remaining, muted, onDismiss])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    try { localStorage.setItem(MUTE_KEY, next ? '1' : '0') } catch { /* ignore */ }
  }

  if (!timer && !finishedLabel) return null

  const done = remaining === 0
  const pct = timer && timer.totalSeconds > 0
    ? Math.max(0, Math.min(100, (remaining / timer.totalSeconds) * 100))
    : 0

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: isMobile ? 0 : 224,
        right: 0,
        bottom: 0,
        zIndex: 60,
        background: done ? 'var(--sage)' : 'var(--panel-bg)',
        color: done ? '#fff' : 'var(--panel-text)',
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
        boxShadow: '0 -6px 24px rgba(0,0,0,.18)',
      }}
    >
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!done && (
          <div style={{ height: 3, background: 'rgba(255,255,255,.18)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .25s linear' }} />
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
            <span style={{ font: mono(26, 600), letterSpacing: '-0.02em', lineHeight: 1 }}>
              {done ? '00:00' : formatTimerClock(remaining)}
            </span>
            <span style={{ font: sans(13.5, 500), opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {done ? 'Przerwa skończona — kolejna seria!' : `Przerwa · ${timer?.label ?? ''}`}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {!done && (
              <>
                <button type="button" onClick={() => onAdjust(-15)} style={pillBtn}>−15 s</button>
                <button type="button" onClick={() => onAdjust(15)} style={pillBtn}>+15 s</button>
              </>
            )}
            <button
              type="button"
              onClick={toggleMute}
              title={muted ? 'Włącz dźwięk' : 'Wycisz dźwięk'}
              aria-label={muted ? 'Włącz dźwięk timera' : 'Wycisz dźwięk timera'}
              style={pillBtn}
            >
              {muted ? 'Bez dźwięku' : 'Dźwięk'}
            </button>
            <button
              type="button"
              onClick={() => { setFinishedLabel(null); onDismiss() }}
              style={{ ...pillBtn, background: 'rgba(255,255,255,.22)' }}
            >
              {done ? 'OK' : 'Pomiń'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const pillBtn: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,.28)',
  background: 'rgba(255,255,255,.1)',
  color: 'inherit',
  borderRadius: 999,
  height: 34,
  padding: '0 12px',
  font: mono(12, 600),
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}
