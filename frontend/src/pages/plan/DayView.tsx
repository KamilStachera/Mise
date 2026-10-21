import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginUrl, type FridgeItem, type PlanEntry, type Slot } from '../../api/client'
import { useActivity, useAuth, useBudget, useCatering, useDeletePlanEntry, useDiscardCook, useEatFromCook, useFeminine, useFridge, useLogCatering, usePatchPlanEntry, usePlan, useProgress, useRecipes } from '../../api/hooks'
import { BudgetMeter, CookMark, DiaryItem, PortionDots, SourceTag, WeekDayBar, cookLetters, dayTotals, entryTitle } from '../../components/diary/parts'
import { useDiarySheets } from '../../components/diary/useDiarySheets'
import { RecipeThumb } from '../../components/RecipeThumb'
import { TAB_BAR_HEIGHT } from '../../components/TabBar'
import { Button, Eyebrow, PageTitle, SectionHead, mono, sans, usePagePad } from '../../components/ui'
import { DAY_NAMES_PL, DIARY_SLOTS, formatKcal, slotForNow, slotLabel } from '../../lib/labels'
import { WEEKDAY_SHORT, addDays, dayShortMonth, daysAgo, mondayOf, parseISODate, syncLabel, toISO } from '../../lib/dates'
import { showToast } from '../../lib/toastBus'
import { useIsMobile } from '../../lib/useIsMobile'

/** Mono accent tag under the day name: DZIŚ, WCZORAJ, ZA 2 DNI… */
function relativeTag(iso: string): string | null {
  const ago = daysAgo(iso)
  if (ago === 0) return 'dziś'
  if (ago === 1) return 'wczoraj'
  if (ago === -1) return 'jutro'
  if (ago < 0) return `za ${-ago} dni`
  if (ago < 7) return `${ago} dni temu`
  return null
}

const dayName = (d: Date) => DAY_NAMES_PL[(d.getDay() + 6) % 7]

/**
 * Plan → Dzień: the day as eaten against the budget (P1–P6, D1). Today/past days log food;
 * future days show the plan („W planie”).
 */
export function DayView({ day, onDay, switcher }: { day: string; onDay: (iso: string) => void; switcher: ReactNode }) {
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit, isLoading: authLoading } = useAuth()
  const date = parseISODate(day)
  const weekStart = toISO(mondayOf(date))
  const { data: plan } = usePlan(weekStart)
  const { data: recipes } = useRecipes('all', '')
  const today = toISO(new Date())
  const { data: fridge = [] } = useFridge(today)
  const patch = usePatchPlanEntry()
  const nav = useNavigate()
  const { data: budget } = useBudget(weekStart)
  const { data: progress } = useProgress(84)
  const { data: activity } = useActivity(7)
  const dayBudget = budget?.days.find((b) => b.date === day)
  const { openAdd, openEntry, sheets } = useDiarySheets()
  const { data: catering } = useCatering()
  const logCatering = useLogCatering()
  const deleteEntry = useDeletePlanEntry()
  const feminine = useFeminine()
  const touchX = useRef<number | null>(null)

  const recipeById = useMemo(() => new Map((recipes ?? []).map((r) => [r.id, r])), [recipes])
  const weekEntries = useMemo(() => (plan?.entries ?? []).filter((e) => e.date >= weekStart && e.date < toISO(addDays(parseISODate(weekStart), 7))), [plan, weekStart])
  const letters = useMemo(() => cookLetters(weekEntries), [weekEntries])
  const entries = weekEntries.filter((e) => e.date === day)
  const meals = entries.filter((e) => !e.isCatering)
  const boxes = entries.filter((e) => e.isCatering)
  const totals = dayTotals(entries)
  const future = day > today
  const prev = toISO(addDays(date, -1))
  const next = toISO(addDays(date, 1))
  const tag = relativeTag(day)
  const missing = entries.filter((e) => e.kcalMissing)

  if (!canEdit && !authLoading) return <PrivateDiary switcher={switcher} />

  const toggle = (e: PlanEntry) => patch.mutate({ id: e.id, patch: { eaten: !e.eaten } })
  const addLabel = future ? '+ Zaplanuj posiłek' : '+ Dodaj jedzenie'
  const onAdd = () => openAdd(day, future ? 'lunch' : 'snack')

  const dayNav = (
    <div
      style={{ display: 'grid', gridTemplateColumns: '44px 1fr 44px', alignItems: 'center', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', padding: '8px 0' }}
    >
      <button type="button" aria-label="Poprzedni dzień" onClick={() => onDay(prev)} style={arrow}>‹</button>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 24 }}>
          {dayName(date)} <span style={{ fontStyle: 'italic', color: 'var(--text-3)' }}>{dayShortMonth(date)}</span>
        </span>
        {tag && <span style={{ font: mono(11, 500), letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent-text)' }}>{tag}</span>}
      </div>
      <button type="button" aria-label="Następny dzień" onClick={() => onDay(next)} style={arrow}>›</button>
    </div>
  )

  const over = !future && dayBudget != null && totals.eaten > dayBudget.budget ? totals.eaten - dayBudget.budget : 0
  const meter = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <BudgetMeter
        totals={totals}
        target={dayBudget?.target ?? null}
        activityBonus={dayBudget?.bonus ?? 0}
        proteinTarget={budget?.proteinTarget}
        mode={future ? 'plan' : 'day'}
        footer={budget && budget.target == null && (
          <button type="button" onClick={() => nav('/profile/cel')} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, font: sans(14, 600), color: 'var(--accent-text)', cursor: 'pointer' }}>
            Ustaw dzienny cel i białko ›
          </button>
        )}
      />
      {over > 0 && (
        <p style={{ margin: 0, font: sans(14.5), lineHeight: 1.5, color: 'var(--text-2)' }}>
          {formatKcal(over)} kcal ponad budżet. Jutro nowy dzień.
          {progress?.week && progress.week.deficit > 0 && ` W skali tygodnia to wciąż −${formatKcal(progress.week.deficit)} kcal.`}
        </p>
      )}
      {missing.length > 0 && (
        <p style={{ margin: 0, font: sans(14.5), lineHeight: 1.5, color: 'var(--text-2)' }}>
          ~ {missing.map(entryTitle).join(', ')} {missing.length === 1 ? 'nie ma' : 'nie mają'} jeszcze kcal, więc suma jest niepełna. Uzupełnij w przepisie albo poproś Sous.
        </p>
      )}
    </div>
  )

  const slots = entries.length === 0 ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '36px 0', borderTop: '1px solid var(--rule)', textAlign: 'center' }}>
      <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 30 }}>Czysta kartka.</span>
      <span style={{ font: sans(14.5), color: 'var(--text-2)', maxWidth: 320 }}>
        {future ? 'Nic jeszcze nie zaplanowane na ten dzień.' : 'Dodaj pierwszy posiłek — albo coś słodkiego. Budżet czeka.'}
      </span>
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {DIARY_SLOTS.map((s) => (
        <SlotBlock
          key={s}
          slot={s}
          entries={meals.filter((e) => e.slot === s)}
          onAdd={() => openAdd(day, s)}
          canEdit={canEdit}
        >
          {meals.filter((e) => e.slot === s).map((e) => (
            <DiaryItem
              key={e.id}
              entry={e}
              recipe={e.recipeId ? recipeById.get(e.recipeId) : undefined}
              letter={e.cookId ? letters.get(e.cookId) : undefined}
              canEdit={canEdit}
              busy={patch.isPending}
              onToggleEaten={() => toggle(e)}
              onOpen={() => openEntry(e)}
            />
          ))}
        </SlotBlock>
      ))}
    </div>
  )

  // Catering: one eaten box entry per delivery day, written by the server. Unticking it means
  // „dziś bez cateringu” (the entry goes; the server never brings it back).
  const cateringOn = catering?.configured === true && catering.enabled
  const delivers = cateringOn && catering.startDate != null && day >= catering.startDate
    && (catering.weekdays & (1 << ((date.getDay() + 6) % 7))) !== 0
  const cateringBlock = (boxes.length > 0 || cateringOn) && (
    <section style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0 8px', borderTop: '1px solid var(--rule)' }}>
        <Eyebrow tone="ink">Catering</Eyebrow>
        <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {boxes.length > 0 && <span style={{ font: mono(12.5), color: 'var(--text-2)' }}>{formatKcal(dayTotals(boxes).eaten)} kcal</span>}
          {canEdit && (
            <button type="button" onClick={() => nav('/profile/cel#catering')} style={{ border: 0, background: 'transparent', padding: 0, font: sans(13.5, 600), color: 'var(--text-2)', cursor: 'pointer' }}>
              Ustawienia
            </button>
          )}
        </span>
      </div>
      {boxes.map((e) => (
        <DiaryItem
          key={e.id}
          entry={e}
          canEdit={canEdit}
          busy={deleteEntry.isPending}
          onToggleEaten={() => { if (confirm('Dziś bez cateringu?')) deleteEntry.mutate(e.id) }}
          onOpen={() => openEntry(e)}
        />
      ))}
      {boxes.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ font: sans(14.5), color: 'var(--text-3)' }}>
            {future
              ? delivers ? `Dostawa — ${formatKcal(catering!.kcal)} kcal doliczy się sama.` : 'Bez dostawy tego dnia.'
              : 'Bez cateringu tego dnia.'}
          </span>
          {canEdit && !future && cateringOn && (
            <Button variant="outline" size="sm" disabled={logCatering.isPending} onClick={() => logCatering.mutate(day)}>
              + Catering
            </Button>
          )}
        </div>
      )}
    </section>
  )

  const actDay = activity?.days.find((a) => a.date === day)
  const activityBlock = !future && activity && (activity.state !== 'none' || (actDay?.activeKcal ?? 0) > 0) && (
    <button
      type="button"
      onClick={() => nav('/plan/aktywnosc')}
      style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, padding: '12px 0 0', border: 0, borderTop: '1px solid var(--rule)', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Eyebrow tone="ink">Aktywność</Eyebrow>
          {activity.state !== 'none' && <SourceTag band />}
          {activity.lastSyncAt && <span style={{ font: mono(11.5), color: activity.state === 'stale' ? 'var(--gold-text)' : 'var(--text-3)' }}>zsynchronizowano {syncLabel(activity.lastSyncAt)}</span>}
        </span>
        <span style={{ font: mono(13.5), lineHeight: 1.5 }}>
          {[...(actDay?.workouts ?? []).map((w) => `${w.type} ${w.minutes} min`), `${formatKcal(actDay?.activeKcal ?? 0)} kcal aktywnych`].join(' · ')}
        </span>
        {(dayBudget?.bonus ?? 0) > 0 && (
          <span style={{ font: sans(14), color: 'var(--text-2)' }}>
            Do budżetu doliczono {activity.addBackPercent === 50 ? 'połowę' : `${activity.addBackPercent} %`}: <span style={{ font: mono(13.5, 500), color: 'var(--text)' }}>+{formatKcal(dayBudget!.bonus)} kcal</span>
          </span>
        )}
      </span>
      <span style={{ fontSize: 18, color: 'var(--text-2)' }}>›</span>
    </button>
  )

  const fridgeBlock = !future && fridge.length > 0 && (
    <FridgeStrip items={fridge} day={day} letters={letters} recipeImage={(id) => (id ? recipeById.get(id) : undefined)} />
  )

  const weekBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionHead title="Ten tydzień" meta={`${dayShortMonth(parseISODate(weekStart))} – ${dayShortMonth(addDays(parseISODate(weekStart), 6))}`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
        {Array.from({ length: 7 }, (_, i) => {
          const iso = toISO(addDays(parseISODate(weekStart), i))
          return (
            <button key={iso} type="button" onClick={() => onDay(iso)} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ font: mono(10.5, iso === day ? 600 : 500), color: iso === day ? 'var(--text)' : 'var(--text-3)' }}>{WEEKDAY_SHORT[i].slice(0, 2).toUpperCase()}</span>
              <WeekDayBar totals={dayTotals(weekEntries.filter((e) => e.date === iso))} budget={budget?.days.find((b) => b.date === iso)?.budget ?? null} />
            </button>
          )
        })}
      </div>
      {progress?.week && (
        <span style={{ font: mono(12), color: 'var(--text-2)' }}>
          średnio {formatKcal(progress.week.avgEaten)} / {formatKcal(progress.week.avgBudget)} kcal{progress.streak > 1 ? ` · seria ${progress.streak} dni` : ''}
        </span>
      )}
    </div>
  )

  return (
    <div
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (Math.abs(dx) > 70) onDay(dx < 0 ? next : prev)
      }}
      style={{ ...pad, paddingBottom: isMobile ? 150 : 64, maxWidth: isMobile ? undefined : 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 28 }}
    >
      {isMobile ? (
        <>
          <PageTitle title="Plan" right={switcher} />
          {dayNav}
          {meter}
          {cateringBlock}
          {slots}
          {fridgeBlock}
          {activityBlock}
          <span style={{ textAlign: 'center', font: mono(11.5), color: 'var(--text-3)' }}>‹ przesuń, żeby zmienić dzień ›</span>
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`, zIndex: 20, padding: '12px 16px 10px', background: 'var(--bg)', boxShadow: '0 -1px 0 var(--border)' }}>
            <Button size="xl" style={{ width: '100%' }} onClick={onAdd}>{addLabel}</Button>
          </div>
        </>
      ) : (
        <>
          <PageTitle
            title="Plan"
            sub={`${dayName(date)} ${dayShortMonth(date)}. ${future ? `W planie ~${formatKcal(totals.planned)} kcal.` : `${feminine ? 'Zjadłaś' : 'Zjadłeś'} ${formatKcal(totals.eaten)} kcal.`}`}
            right={
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {switcher}
                <Button variant="quiet" size="sm" onClick={() => onDay(prev)}>‹ {dayName(addDays(date, -1))}</Button>
                <Button variant="quiet" size="sm" onClick={() => onDay(next)}>{dayName(addDays(date, 1))} ›</Button>
                <Button onClick={onAdd}>{addLabel}</Button>
              </div>
            }
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: 48, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
              {meter}
              {cateringBlock}
              {slots}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
              {fridgeBlock}
              {activityBlock}
              {day !== today && (
                <Button variant="dark" size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => onDay(today)}>Dziś</Button>
              )}
              {weekBlock}
            </div>
          </div>
        </>
      )}
      {sheets}
    </div>
  )
}

const arrow: CSSProperties = { height: 44, border: 0, background: 'transparent', cursor: 'pointer', font: sans(20), color: 'var(--text)' }

/** „W lodówce”: pots with portions left; one tap eats a portion into the current slot. */
function FridgeStrip({ items, day, letters, recipeImage }: {
  items: FridgeItem[]
  day: string
  letters: Map<string, string>
  recipeImage: (id: string | null) => { imageUrl: string | null; tint: string; title: string } | undefined
}) {
  const eat = useEatFromCook()
  const discard = useDiscardCook()
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <SectionHead title="W lodówce" meta={`${items.length} ${items.length === 1 ? 'danie' : items.length < 5 ? 'dania' : 'dań'}`} />
      {items.map((f, i) => {
        const r = recipeImage(f.recipeId)
        const letter = letters.get(f.cookId) ?? String.fromCharCode(65 + i)
        return (
          <div key={f.cookId} style={{ display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr) auto', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <RecipeThumb r={r ?? { title: f.title, tint: '#c0552d', imageUrl: null }} letterSize={18} style={{ width: 52, height: 52, borderRadius: 10 }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CookMark letter={letter} filled={false} />
                <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <PortionDots total={f.portions} left={f.remaining} />
                <span style={{ font: mono(12), color: 'var(--text-3)' }}>
                  {f.remaining} z {f.portions} porcji{f.kcalPerPortion != null ? ` · ${f.kcalPerPortion} kcal` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => { if (confirm(`Wyrzucić resztę: ${f.title}?`)) discard.mutate(f.cookId) }}
                  style={{ border: 0, background: 'transparent', padding: 0, font: sans(12.5), color: 'var(--text-3)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  wyrzucone
                </button>
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={eat.isPending}
              onClick={async () => {
                await eat.mutateAsync({ id: f.cookId, date: day, slot: slotForNow() })
                showToast(`Zjedzona porcja: ${f.title}`)
              }}
            >
              Zjem porcję
            </Button>
          </div>
        )
      })}
    </div>
  )
}

/** P6 — anonymous visitors: the diary is private, recipes stay browsable. */
export function PrivateDiary({ switcher }: { switcher: ReactNode }) {
  const pad = usePagePad()
  const nav = useNavigate()
  return (
    <div style={{ ...pad, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
      <PageTitle title="Plan" right={switcher} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 20, borderTop: '1px solid var(--rule)' }}>
        <Eyebrow tone="accent">Prywatne</Eyebrow>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 30, lineHeight: 1.15 }}>Dziennik jest prywatny — zaloguj się</span>
        <p style={{ margin: 0, font: sans(15), lineHeight: 1.5, color: 'var(--text-2)' }}>
          Co zjedzone, ile kcal i resztki w lodówce widać tylko po zalogowaniu. Plan tygodnia i przepisy są dostępne dla wszystkich.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 6 }}>
          <Button variant="outline" onClick={() => { window.location.href = loginUrl('/plan/dzien') }}>Zaloguj się</Button>
          <Button variant="text" onClick={() => nav('/')}>Przeglądaj przepisy ›</Button>
        </div>
      </div>
      <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: 0.5 }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ height: 44, borderTop: '1px solid var(--border)' }} />)}
      </div>
    </div>
  )
}

/** One diary slot: ink eyebrow on a strong rule, subtotal (~ while only planned), „+ Dodaj”. */
function SlotBlock({ slot, entries: list, onAdd: add, canEdit, children }: { slot: Slot; entries: PlanEntry[]; onAdd: () => void; canEdit: boolean; children: ReactNode }) {
  const t = dayTotals(list)
  const planned = list.length > 0 && list.every((e) => !e.eaten)
  // What was eaten; the planned estimate only while nothing in the slot is eaten yet.
  const sum = list.length === 0 ? '' : `${planned || t.missing ? '~' : ''}${formatKcal(planned ? t.planned : t.eaten)} kcal`
  return (
    <section style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0 8px', borderTop: '1px solid var(--rule)' }}>
        <Eyebrow tone="ink">{slotLabel[slot]}</Eyebrow>
        <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ font: mono(12.5), color: planned ? 'var(--text-3)' : 'var(--text-2)' }}>{sum}</span>
          {canEdit && (
            <button type="button" onClick={add} style={{ border: 0, background: 'transparent', padding: 0, font: sans(13.5, 600), color: 'var(--text-2)', cursor: 'pointer' }}>
              + Dodaj
            </button>
          )}
        </span>
      </div>
      {children}
    </section>
  )
}
