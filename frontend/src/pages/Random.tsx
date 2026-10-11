import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useCookLog, useRecipes } from '../api/hooks'
import type { RecipeListItem } from '../api/client'
import { gradient } from '../lib/colors'
import { daysAgo } from '../lib/dates'
import { cuisineLabel, dishTypeLabel, recipeCountLabel, sourceBadge } from '../lib/labels'
import { requestChat } from '../lib/chatBus'
import { ClockIcon, DiceIcon, ChevronRight } from '../components/icons'

type RndType = 'all' | 'main' | 'breakfast' | 'side'
type RndTime = 'all' | '20' | '30'

const TYPE_OPTIONS: { key: RndType; label: string }[] = [
  { key: 'all', label: 'Cokolwiek' },
  { key: 'main', label: 'Danie główne' },
  { key: 'breakfast', label: 'Śniadanie' },
  { key: 'side', label: 'Dodatek' },
]

const TIME_OPTIONS: { key: RndTime; label: string }[] = [
  { key: 'all', label: 'Dowolny' },
  { key: '20', label: '≤ 20 min' },
  { key: '30', label: '≤ 30 min' },
]

const HISTORY_KEY = 'mise-random-history'
const HISTORY_MAX = 4

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const ruleLabel: CSSProperties = {
  font: "700 11px var(--sans)",
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  flex: '0 0 62px',
}

function segBtn(on: boolean): CSSProperties {
  return {
    border: 'none',
    borderRadius: 8,
    padding: '7px 14px',
    font: "600 12.5px var(--sans)",
    cursor: 'pointer',
    background: on ? 'var(--card)' : 'transparent',
    color: on ? 'var(--accent-deep)' : 'var(--text-2)',
    boxShadow: on ? '0 1px 4px rgba(80,60,30,.14)' : 'none',
    transition: 'all .13s',
    whiteSpace: 'nowrap',
  }
}

function togglePill(on: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid ' + (on ? 'rgba(110,122,82,.55)' : 'var(--border)'),
    background: on ? 'rgba(110,122,82,.12)' : 'var(--surface)',
    color: on ? 'var(--sage)' : 'var(--text-2)',
    borderRadius: 20,
    padding: '8px 14px',
    font: "600 12.5px var(--sans)",
    cursor: 'pointer',
    transition: 'all .13s',
  }
}

function toggleDot(on: boolean): CSSProperties {
  return { width: 8, height: 8, borderRadius: '50%', background: on ? 'var(--sage)' : 'var(--border-2)', transition: 'background .13s' }
}

const RECENT_COOK_DAYS = 7

export function Random() {
  const nav = useNavigate()
  const { canEdit } = useAuth()
  const { data: recipes = [] } = useRecipes('all', '')
  const { data: cookLog = [] } = useCookLog()

  const [rndType, setRndType] = useState<RndType>('all')
  const [rndTime, setRndTime] = useState<RndTime>('all')
  const [pantryOnly, setPantryOnly] = useState(false)
  const [skipRecent, setSkipRecent] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [pickId, setPickId] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)
  const [flash, setFlash] = useState('')
  const [history, setHistory] = useState<string[]>(loadHistory)
  const spinTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  }, [history])

  useEffect(() => () => {
    if (spinTimer.current) clearInterval(spinTimer.current)
  }, [])

  const basePool = useMemo(
    () =>
      recipes
        .filter((r) => rndType === 'all' || r.dishType === rndType)
        .filter((r) => rndTime === 'all' || r.time <= Number(rndTime))
        .filter((r) => !pantryOnly || r.toBuyCount === 0),
    [recipes, rndType, rndTime, pantryOnly],
  )

  const recentlyCooked = useMemo(
    () => new Set(cookLog.filter((e) => e.recipeId && daysAgo(e.cookedAt) < RECENT_COOK_DAYS).map((e) => e.recipeId as string)),
    [cookLog],
  )

  // "Skip recent" narrows the pool only while something else is left to pick.
  // Recent = the last few spins plus anything actually cooked this week.
  function drawPool(): RecipeListItem[] {
    if (!skipRecent) return basePool
    const fresh = basePool.filter((r) => !history.includes(r.id) && !recentlyCooked.has(r.id))
    return fresh.length > 0 ? fresh : basePool
  }

  function remember(id: string) {
    setHistory((h) => [id, ...h.filter((x) => x !== id)].slice(0, HISTORY_MAX))
  }

  function spin() {
    if (spinning) return
    if (spinTimer.current) clearInterval(spinTimer.current)
    const pool = drawPool()
    if (pool.length === 0) {
      setEmpty(true)
      setPickId(null)
      setSpinning(false)
      return
    }
    const winner = pool[Math.floor(Math.random() * pool.length)]
    if (pool.length === 1) {
      setEmpty(false)
      setPickId(winner.id)
      remember(winner.id)
      return
    }
    let i = 0
    const ticks = 10 + Math.floor(Math.random() * 5)
    setSpinning(true)
    setPickId(null)
    setEmpty(false)
    setFlash(pool[0].title)
    spinTimer.current = setInterval(() => {
      i++
      if (i >= ticks) {
        if (spinTimer.current) clearInterval(spinTimer.current)
        setSpinning(false)
        setFlash('')
        setPickId(winner.id)
        remember(winner.id)
      } else {
        setFlash(pool[i % pool.length].title)
      }
    }, 110)
  }

  function resetRules() {
    setRndType('all')
    setRndTime('all')
    setPantryOnly(false)
    setEmpty(false)
    setPickId(null)
  }

  function clearResult() {
    setPickId(null)
    setEmpty(false)
  }

  const pick = pickId !== null && !spinning ? recipes.find((r) => r.id === pickId) ?? null : null
  const idle = !spinning && !pick && !empty
  const historyView = history
    .filter((id) => id !== pickId)
    .map((id) => recipes.find((r) => r.id === id))
    .filter((r): r is RecipeListItem => !!r)

  const poolLabel =
    basePool.length === 0
      ? 'Nic nie pasuje do tych zasad'
      : basePool.length === 1
        ? 'Tylko jeden kandydat na dziś'
        : `${recipeCountLabel(basePool.length)} w puli`

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '38px 42px 60px' }}>
      <div style={{ font: "600 11px var(--sans)", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 7 }}>
        Ruletka obiadowa
      </div>
      <h1 style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: 38, lineHeight: 1.05, margin: '0 0 5px', color: 'var(--text)' }}>
        Losowy posiłek
      </h1>
      <p style={{ fontSize: 14.5, color: 'var(--text-2)', margin: '0 0 24px' }}>
        Ustaw zasady, zakręć i niech los zdecyduje, co dziś jecie.
      </p>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={ruleLabel}>Posiłek</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', maxWidth: '100%', gap: 3, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: 3 }}>
            {TYPE_OPTIONS.map((o) => (
              <button key={o.key} onClick={() => { setRndType(o.key); clearResult() }} style={segBtn(rndType === o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={ruleLabel}>Czas</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', maxWidth: '100%', gap: 3, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: 3 }}>
            {TIME_OPTIONS.map((o) => (
              <button key={o.key} onClick={() => { setRndTime(o.key); clearResult() }} style={segBtn(rndTime === o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={ruleLabel}>Zasady</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => { setPantryOnly((v) => !v); clearResult() }} style={togglePill(pantryOnly)}>
              <span style={toggleDot(pantryOnly)} />
              Tylko to, co mam w spiżarni
            </button>
            <button
              onClick={() => setSkipRecent((v) => !v)}
              style={togglePill(skipRecent)}
              title="Pomija ostatnie 4 losowania i wszystko, co według historii gotowaliście w ciągu 7 dni"
            >
              <span style={toggleDot(skipRecent)} />
              Pomijaj ostatnie dania
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 18 }}>
        <div style={{ font: "500 13px var(--sans)", color: 'var(--text-3)' }}>{poolLabel}</div>
        <button
          onClick={spin}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            borderRadius: 13,
            padding: '13px 26px',
            font: "700 14.5px var(--sans)",
            cursor: spinning ? 'default' : 'pointer',
            boxShadow: '0 6px 18px rgba(160,66,32,.26)',
            opacity: spinning ? 0.75 : 1,
            transition: 'opacity .13s',
          }}
        >
          <span style={{ display: 'flex', animation: spinning ? 'diceShake .4s ease infinite' : 'none' }}>
            <DiceIcon size={17} />
          </span>
          {spinning ? 'Kręcę…' : pick ? 'Zakręć jeszcze raz' : 'Zakręć kołem'}
        </button>
      </div>

      {idle && (
        <DashedPanel>
          <div style={{ width: 58, height: 58, borderRadius: 16, background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
            <DiceIcon size={27} color="var(--accent)" />
          </div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>Los jeszcze nie przemówił</div>
          <div style={{ fontSize: 13.5, color: 'var(--text-2)', maxWidth: '38ch' }}>
            Jedno kręcenie, jeden obiad. Bez przewijania i bez wahania — taka umowa.
          </div>
        </DashedPanel>
      )}

      {spinning && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '70px 24px', border: '1.5px dashed var(--accent)', borderRadius: 18, background: 'var(--accent-soft)' }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 24, fontWeight: 600, color: 'var(--accent-deep)', textAlign: 'center', lineHeight: 1.25 }}>
            {flash}
          </div>
        </div>
      )}

      {pick && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', animation: 'fadeUp .35s ease' }}>
          <div style={{ position: 'relative', height: 128, background: gradient(pick.tint), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {pick.imageUrl ? (
              <img src={pick.imageUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontFamily: "var(--serif)", fontSize: 64, fontWeight: 500, color: 'rgba(255,255,255,.9)', lineHeight: 1 }}>
                {pick.title[0]}
              </span>
            )}
            <span style={{ position: 'absolute', top: 11, left: 11, font: "700 10px var(--sans)", letterSpacing: '.08em', padding: '4px 8px', borderRadius: 7, background: 'rgba(255,255,255,.92)', color: sourceBadge[pick.source].col }}>
              {sourceBadge[pick.source].label}
            </span>
          </div>
          <div style={{ padding: '20px 24px 22px' }}>
            <div style={{ font: "600 11px var(--sans)", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>
              Dziś gotujesz
            </div>
            <h2 style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: 26, lineHeight: 1.12, margin: '0 0 8px', color: 'var(--text)' }}>
              {pick.title}
            </h2>
            {pick.blurb && <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)', margin: '0 0 14px' }}>{pick.blurb}</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, font: "500 13px var(--sans)", color: 'var(--text-2)', marginBottom: 18, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ClockIcon size={14} />
                {pick.time} min
              </span>
              <span>
                {[pick.dishType && dishTypeLabel[pick.dishType], pick.cuisine && `kuchnia ${cuisineLabel[pick.cuisine]}`, `porcje: ${pick.servings}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span
                style={{
                  font: "600 11.5px var(--sans)",
                  color: pick.toBuyCount === 0 ? 'var(--sage)' : 'var(--accent)',
                  background: pick.toBuyCount === 0 ? 'rgba(110,122,82,.12)' : 'var(--accent-soft)',
                  padding: '3px 9px',
                  borderRadius: 7,
                }}
              >
                {pick.toBuyCount === 0 ? 'Wszystko jest' : `${pick.toBuyCount} do kupienia`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => nav(`/recipe/${pick.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 11, padding: '11px 20px', font: "600 13.5px var(--sans)", cursor: 'pointer' }}
              >
                Ugotuj to <ChevronRight />
              </button>
              <button
                onClick={spin}
                style={{ border: '1px solid var(--border-2)', background: 'transparent', color: 'var(--text)', borderRadius: 11, padding: '11px 18px', font: "600 13.5px var(--sans)", cursor: 'pointer' }}
              >
                Zakręć jeszcze raz
              </button>
            </div>
          </div>
        </div>
      )}

      {empty && (
        <DashedPanel>
          <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>Nic nie pasuje do tych zasad</div>
          <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
            Poluzuj limit czasu albo wyłącz zasadę spiżarni — albo poproś Sous o coś nowego.
          </div>
          <button
            onClick={resetRules}
            style={{ marginTop: 10, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '9px 16px', font: "600 13px var(--sans)", cursor: 'pointer' }}
          >
            Zresetuj zasady
          </button>
        </DashedPanel>
      )}

      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button
            onClick={() => requestChat('Zaskocz mnie — wymyśl coś nowego z tego, co mam w spiżarni')}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-2)', font: "500 13px var(--sans)", cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-2)')}
          >
            <span style={{ color: 'var(--gold)' }}>✦</span>
            Nic nie pasuje? Poproś Sous o nowy pomysł
          </button>
        </div>
      )}

      {historyView.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ font: "700 11px var(--sans)", letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 9 }}>
            Poprzednie losowania
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {historyView.map((r) => (
              <button
                key={r.id}
                onClick={() => nav(`/recipe/${r.id}`)}
                style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-2)', borderRadius: 20, padding: '7px 13px', font: "500 12.5px var(--sans)", cursor: 'pointer' }}
              >
                {r.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DashedPanel({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, textAlign: 'center', padding: '52px 24px', border: '1.5px dashed var(--border-2)', borderRadius: 18, background: 'var(--surface)' }}>
      {children}
    </div>
  )
}
