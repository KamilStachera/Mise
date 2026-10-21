import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, useCookLog, useRecipes } from '../api/hooks'
import type { RecipeListItem } from '../api/client'
import { daysAgo } from '../lib/dates'
import { plural, recipeCountLabel } from '../lib/labels'
import { requestChat } from '../lib/chatBus'
import { useIsMobile } from '../lib/useIsMobile'
import { RecipeThumb, StockNote } from '../components/RecipeThumb'
import { AddToPlanSheet } from '../components/AddToPlanSheet'
import { TAB_BAR_HEIGHT } from '../components/TabBar'
import { Button, Chip, Eyebrow, PageTitle, Toggle, mono, sans, usePagePad } from '../components/ui'

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
const RECENT_COOK_DAYS = 7
/** Phone bottom button block (two 54px buttons + pool line). */
const MOBILE_ACTIONS = 96

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function Random() {
  const nav = useNavigate()
  const isMobile = useIsMobile()
  const pad = usePagePad()
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
  const [flash, setFlash] = useState<RecipeListItem | null>(null)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [planOpen, setPlanOpen] = useState(false)
  const spinTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    } catch {
      /* storage blocked — history just won't persist */
    }
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
    setFlash(pool[0])
    spinTimer.current = setInterval(() => {
      i++
      if (i >= ticks) {
        if (spinTimer.current) clearInterval(spinTimer.current)
        setSpinning(false)
        setFlash(null)
        setPickId(winner.id)
        remember(winner.id)
      } else {
        setFlash(pool[i % pool.length])
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
  const shown = spinning ? flash : pick
  const historyView = history
    .filter((id) => id !== pickId)
    .map((id) => recipes.find((r) => r.id === id))
    .filter((r): r is RecipeListItem => !!r)
    .slice(0, 3)

  const poolLabel =
    basePool.length === 0
      ? 'Nic nie pasuje do tych zasad'
      : basePool.length === 1
        ? 'Tylko jeden kandydat na dziś'
        : `${recipeCountLabel(basePool.length)} w puli`

  const askSous = canEdit && (
    <span style={{ font: sans(14), color: 'var(--text-2)' }}>
      <span style={{ color: 'var(--accent)' }}>✦</span> Nic nie pasuje?{' '}
      <button
        type="button"
        onClick={() => requestChat('Zaskocz mnie — wymyśl coś nowego z tego, co mam w spiżarni')}
        style={{ border: 0, borderBottom: '1px solid currentColor', background: 'transparent', padding: 0, cursor: 'pointer', font: sans(14, 600), color: 'var(--text)' }}
      >
        Poproś Sous o nowy pomysł
      </button>
    </span>
  )

  const rules = (
    <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--rule)' }}>
      <RuleRow label="Posiłek">
        {TYPE_OPTIONS.map((o) => (
          <Chip key={o.key} active={rndType === o.key} onClick={() => { setRndType(o.key); clearResult() }}>{o.label}</Chip>
        ))}
      </RuleRow>
      <RuleRow label="Czas">
        {TIME_OPTIONS.map((o) => (
          <Chip key={o.key} active={rndTime === o.key} onClick={() => { setRndTime(o.key); clearResult() }}>{o.label}</Chip>
        ))}
      </RuleRow>
      <Toggle label="Tylko to, co mam w spiżarni" on={pantryOnly} onChange={(v) => { setPantryOnly(v); clearResult() }} />
      <Toggle label="Pomijaj ostatnie dania" on={skipRecent} onChange={setSkipRecent} />
    </div>
  )

  const resultActions = pick && (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <Button variant="dark" size="lg" onClick={() => nav(`/recipe/${pick.id}`)}>Gotuję to</Button>
      <Button variant="outline" size="lg" onClick={spin}>Jeszcze raz</Button>
      {canEdit && <Button variant="quiet" size="lg" onClick={() => setPlanOpen(true)}>Dodaj do planu</Button>}
    </div>
  )

  const previous = historyView.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Eyebrow style={{ paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>Poprzednie losowania</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: isMobile ? 0 : 20, paddingTop: isMobile ? 0 : 14 }}>
        {historyView.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => nav(`/recipe/${r.id}`)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, border: 0, borderBottom: isMobile ? '1px solid var(--border)' : 0, padding: isMobile ? '10px 0' : 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
          >
            <RecipeThumb r={r} letterSize={22} style={{ width: 52, height: 52, borderRadius: 9 }} />
            <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 17, lineHeight: 1.15 }}>{r.title}</span>
          </button>
        ))}
      </div>
    </div>
  )

  // Result panel: idle placeholder / flashing titles / the pick / nothing fits.
  const result = empty ? (
    <Placeholder height={isMobile ? 220 : 420}>
      <span style={{ fontFamily: 'var(--serif)', fontSize: 26 }}>Nic nie pasuje do tych zasad</span>
      <span style={{ font: sans(14.5), color: 'var(--text-2)', maxWidth: '40ch' }}>Poluzuj limit czasu albo wyłącz zasadę spiżarni.</span>
      <Button variant="outline" onClick={resetRules}>Zresetuj zasady</Button>
    </Placeholder>
  ) : shown ? (
    isMobile ? (
      <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <RecipeThumb r={shown} full letterSize={64} style={{ height: 150 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px 16px' }}>
          <Eyebrow tone="accent">{spinning ? 'Losuję…' : 'Los wybrał'}</Eyebrow>
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 24, lineHeight: 1.1 }}>{shown.title}</span>
          <Meta r={shown} />
        </div>
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <RecipeThumb r={shown} full letterSize={120} style={{ height: 420, borderRadius: 16 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Eyebrow tone="accent">{spinning ? 'Losuję…' : 'Los wybrał'}</Eyebrow>
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 44, lineHeight: 1, letterSpacing: '-0.025em' }}>{shown.title}</span>
          <Meta r={shown} size={13} />
        </div>
        {!spinning && resultActions}
      </div>
    )
  ) : (
    <Placeholder height={isMobile ? 220 : 420}>
      <span style={{ fontFamily: 'var(--serif)', fontSize: 26 }}>Los jeszcze nie przemówił</span>
      <span style={{ font: sans(14.5), color: 'var(--text-2)', maxWidth: '38ch' }}>Jedno kręcenie, jeden obiad. Bez przewijania i bez wahania — taka umowa.</span>
    </Placeholder>
  )

  const planSheet = pick && <AddToPlanSheet open={planOpen} onClose={() => setPlanOpen(false)} recipe={pick} />

  if (isMobile) {
    return (
      <div style={{ ...pad, paddingBottom: MOBILE_ACTIONS + 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <button type="button" onClick={() => nav('/')} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, cursor: 'pointer', font: sans(14, 600), color: 'var(--text-2)' }}>← Przepisy</button>
        <PageTitle title="Co dziś jemy?" size={40} />
        {rules}
        {result}
        {pick && canEdit && <Button variant="quiet" onClick={() => setPlanOpen(true)}>Dodaj do planu</Button>}
        {askSous}
        {previous}
        <div data-pinned-bar style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px 10px', background: 'var(--bg)' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {pick ? (
              <>
                <Button variant="outline" size="xl" style={{ flex: 1 }} onClick={spin}>Jeszcze raz</Button>
                <Button size="xl" style={{ flex: 1.4 }} onClick={() => nav(`/recipe/${pick.id}`)}>Gotuję to</Button>
              </>
            ) : (
              <Button size="xl" style={{ flex: 1 }} onClick={spin} disabled={spinning}>{spinning ? 'Kręcę…' : 'Zakręć kołem'}</Button>
            )}
          </div>
          <span style={{ textAlign: 'center', font: mono(12), color: 'var(--text-3)' }}>{poolLabel}</span>
        </div>
        {planSheet}
      </div>
    )
  }

  return (
    <div style={{ ...pad, maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: '420px minmax(0, 1fr)', gap: 56, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <PageTitle title="Co dziś jemy?" sub="Ustaw zasady, zakręć i niech los zdecyduje, co dziś jecie." />
        {rules}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Button size="xl" onClick={spin} disabled={spinning} style={{ height: 56, fontSize: 16 }}>
            {spinning ? 'Kręcę…' : pick ? 'Zakręć jeszcze raz' : 'Zakręć kołem'}
          </Button>
          <span style={{ textAlign: 'center', font: mono(12), color: 'var(--text-3)' }}>{poolLabel}</span>
        </div>
        {askSous}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {result}
        {previous}
      </div>
      {planSheet}
    </div>
  )
}

function RuleRow({ label, children }: { label: string; children: ReactNode }) {
  const isMobile = useIsMobile()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'row' : 'column',
        alignItems: isMobile ? 'center' : 'stretch',
        gap: isMobile ? 12 : 10,
        padding: isMobile ? '12px 0' : '16px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{ width: isMobile ? 58 : undefined, flex: isMobile ? '0 0 58px' : undefined, font: mono(11, 500), letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</span>
      <div className="no-scrollbar" style={{ display: 'flex', flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : undefined, gap: 6, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function Meta({ r, size = 12 }: { r: RecipeListItem; size?: number }) {
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: size > 12 ? 14 : 10, font: mono(size), color: 'var(--text-2)' }}>
      <span>{r.time} min</span>
      <span>{plural(r.servings, 'porcja', 'porcje', 'porcji')}</span>
      {r.kcal != null && <span>~{r.kcal} kcal</span>}
      <StockNote toBuy={r.toBuyCount} />
    </span>
  )
}

function Placeholder({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div style={{ minHeight: height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', padding: 24, borderRadius: 16, border: '1px dashed var(--border-2)' }}>
      {children}
    </div>
  )
}
