import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActivity, useAuth, useBody, useDeleteWeight, useProgress } from '../../api/hooks'
import { WeightChart } from '../../components/diary/WeightChart'
import { WeightSheet } from '../../components/diary/WeightSheet'
import { TAB_BAR_HEIGHT } from '../../components/TabBar'
import { Button, Eyebrow, PageTitle, SectionHead, Segmented, StatStrip, mono, sans, usePagePad } from '../../components/ui'
import { MONTHS_SHORT, addDays, dayShortMonth, mondayOf, parseISODate, syncLabel } from '../../lib/dates'
import { formatKcal } from '../../lib/labels'
import { useIsMobile } from '../../lib/useIsMobile'
import { PrivateDiary } from './DayView'

const kg = (v: number) => v.toFixed(1).replace('.', ',')
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${kg(Math.abs(v))}`

/** Plan → Postępy (P16, D3): weight trend against the goal and the week's balance. */
export function ProgressView({ switcher }: { switcher: ReactNode }) {
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const nav = useNavigate()
  const { canEdit, isLoading } = useAuth()
  const [range, setRange] = useState<'56' | '84'>('56')
  const { data: progress } = useProgress(Number(range))
  const { data: body } = useBody()
  const { data: activity } = useActivity(7)
  const del = useDeleteWeight()
  const [sheet, setSheet] = useState(false)

  if (!canEdit && !isLoading) return <PrivateDiary switcher={switcher} />

  const p = progress
  const stats = p && [
    { value: p.currentKg != null ? `${kg(p.currentKg)} kg` : '—', label: 'teraz', highlight: true },
    { value: p.weeklyChange != null ? `${signed(p.weeklyChange)} kg` : '—', label: isMobile ? 'na tydzień' : 'tempo z trendu' },
    { value: p.sinceStart != null ? `${signed(p.sinceStart)} kg` : '—', label: 'od startu' },
    { value: p.etaWeeks != null ? `~${p.etaWeeks} tyg.` : '—', label: p.goalKg ? `do celu ${String(p.goalKg).replace('.', ',')} kg` : 'do celu' },
  ]
  const monday = mondayOf(new Date())
  const week = p?.week
  const rows: [string, ReactNode][] = week ? [
    ['Średnio zjedzone', `${formatKcal(week.avgEaten)} kcal`],
    ['Średni budżet', `${formatKcal(week.avgBudget)} kcal`],
    ['Deficyt łącznie', (
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span>{week.deficit > 0 ? '−' : '+'}{formatKcal(Math.abs(week.deficit))} kcal</span>
        {Math.abs(week.estLossKg) >= 0.05 && <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>≈ {week.deficit > 0 ? '−' : '+'}{kg(Math.abs(week.estLossKg))} kg</span>}
      </span>
    )],
  ] : []
  if (p && p.streak > 0) rows.push(['Seria wpisów', `${p.streak} ${p.streak === 1 ? 'dzień' : 'dni'} z rzędu`])

  const recent = [...(p?.weights ?? [])].reverse().slice(0, 7)

  const chart = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>
        {isMobile ? <Eyebrow tone="ink">Waga · {range === '56' ? 8 : 12} tygodni</Eyebrow> : <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22 }}>Waga</span>}
        <Segmented value={range} onChange={setRange} style={{ width: 170 }} items={[{ key: '56', label: '8 tyg.' }, { key: '84', label: '12 tyg.' }]} />
      </div>
      {p && p.weights.length > 0 ? (
        <WeightChart points={p.weights} goalKg={p.goalKg} days={Number(range)} height={isMobile ? 230 : 320} />
      ) : (
        <div style={{ padding: '36px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 26 }}>Jeszcze bez ważeń.</span>
          <span style={{ font: sans(14.5), color: 'var(--text-2)' }}>Dodaj pierwszą wagę — trend pojawi się po kilku dniach.</span>
        </div>
      )}
    </div>
  )

  const side = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <SectionHead title="Ten tydzień" meta={`${monday.getDate()}–${dayShortMonth(addDays(monday, 6))}`} />
        {rows.length > 0 ? rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ font: sans(15) }}>{k}</span>
            <span style={{ font: mono(14, 500), textAlign: 'right' }}>{v}</span>
          </div>
        )) : (
          <p style={{ margin: '12px 0 0', font: sans(14), color: 'var(--text-2)' }}>
            {body?.configured ? 'Zaznacz, co zjadłaś — bilans tygodnia policzy się sam.' : 'Ustaw cel, żeby zobaczyć bilans tygodnia.'}
          </p>
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--rule)' }}>
        <LinkRow
          title="Aktywność"
          meta={activity?.state === 'connected' ? `połączona${activity.lastSyncAt ? ` · ${syncLabel(activity.lastSyncAt)}` : ''}`
            : activity?.state === 'stale' ? 'brak danych z opaski' : 'opaska niepodłączona'}
          onClick={() => nav('/plan/aktywnosc')}
        />
        <LinkRow
          title="Twój cel"
          meta={body?.configured && body.target ? `${formatKcal(body.target)} kcal · −${String(body.paceKg).replace('.', ',')} kg / tydz.` : 'jeszcze nieustawiony'}
          onClick={() => nav('/profile/cel')}
        />
      </div>
      {recent.length > 0 && (
        <div>
          <SectionHead title="Ostatnie ważenia" size={18} />
          {recent.map((w) => {
            const d = parseISODate(w.date)
            return (
              <div key={w.date} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)', font: mono(13) }}>
                <span style={{ width: 70, color: 'var(--text-2)' }}>{d.getDate()} {MONTHS_SHORT[d.getMonth()]}</span>
                <span style={{ flex: 1 }}>{kg(w.kg)} kg</span>
                <span style={{ color: 'var(--text-3)' }}>trend {kg(w.trend)}</span>
                <button type="button" aria-label={`Usuń ważenie ${w.date}`} onClick={() => del.mutate(w.date)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', fontSize: 15, padding: '0 2px' }}>×</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ ...pad, paddingBottom: isMobile ? 150 : 64, maxWidth: isMobile ? undefined : 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 20 : 28 }}>
      <PageTitle
        title="Plan"
        sub={isMobile ? undefined : 'Waga, trend i bilans tygodnia.'}
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {switcher}
            {!isMobile && <Button onClick={() => setSheet(true)}>+ Dodaj wagę</Button>}
          </div>
        }
      />
      {body && !body.configured && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'var(--accent-soft)' }}>
          <span style={{ font: sans(14.5), color: 'var(--accent-soft-text)' }}>Kilka liczb o tobie i Pichci policzy dzienny budżet.</span>
          <Button size="sm" onClick={() => nav('/profile/cel')}>Ustaw cel</Button>
        </div>
      )}
      {stats && (isMobile ? (
        <div>
          <StatStrip items={stats.slice(0, 2)} stacked />
          <StatStrip items={stats.slice(2)} stacked style={{ borderTop: 0 }} />
        </div>
      ) : (
        <StatStrip items={stats} stacked />
      ))}
      {isMobile ? (
        <>
          {chart}
          {side}
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`, zIndex: 20, padding: '12px 16px 10px', background: 'var(--bg)', boxShadow: '0 -1px 0 var(--border)' }}>
            <Button size="xl" style={{ width: '100%' }} onClick={() => setSheet(true)}>+ Dodaj wagę</Button>
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 48, alignItems: 'start' }}>
          {chart}
          {side}
        </div>
      )}
      <WeightSheet open={sheet} onClose={() => setSheet(false)} lastKg={p?.currentKg ?? null} trendKg={p?.trendKg ?? null} />
    </div>
  )
}

function LinkRow({ title, meta, onClick }: { title: string; meta: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '14px 0', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 19 }}>{title}</span>
        <span style={{ font: mono(12), color: 'var(--text-2)' }}>{meta}</span>
      </span>
      <span style={{ fontSize: 18, color: 'var(--text-2)' }}>›</span>
    </button>
  )
}
