import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ActivityLevel, Body, BodySex, Catering } from '../api/client'
import { useAuth, useBody, useCatering, usePerson, useSaveBody, useSaveCatering } from '../api/hooks'
import { PersonSwitch } from '../components/diary/PersonSwitch'
import { TAB_BAR_HEIGHT } from '../components/TabBar'
import { Button, Chip, Eyebrow, PageTitle, Segmented, StatStrip, Toggle, inputStyle, mono, sans, usePagePad } from '../components/ui'
import { toISO } from '../lib/dates'
import { previewTargets } from '../lib/body'
import { formatKcal } from '../lib/labels'
import { showToast } from '../lib/toastBus'
import { useIsMobile } from '../lib/useIsMobile'
import { PrivateDiary } from './plan/DayView'

const num = (s: string) => {
  const v = Number(s.replace(',', '.').trim())
  return s.trim() !== '' && Number.isFinite(v) ? v : null
}
const dec = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))

/** „Twój cel” (P18): a few numbers → the daily budget, recomputed live; target can be set by hand. */
export function Goal() {
  const { canEdit, isLoading } = useAuth()
  const { data: body } = useBody()
  const { id } = usePerson()
  if (!canEdit && !isLoading) return <PrivateDiary switcher={null} />
  if (!body) return null
  // Keyed by person: switching remounts the form with the other person's numbers.
  return <GoalForm key={id} body={body} />
}

function GoalForm({ body }: { body: Body }) {
  const nav = useNavigate()
  const { id, own, person } = usePerson()
  const { data: catering } = useCatering()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const save = useSaveBody()

  const [sex, setSex] = useState<BodySex>(body.sex)
  const [birthYear, setBirthYear] = useState(String(body.birthYear))
  const [height, setHeight] = useState(String(body.heightCm))
  const [current, setCurrent] = useState(dec(body.currentKg))
  const [goal, setGoal] = useState(body.configured ? dec(body.goalKg) : '')
  const [activity, setActivity] = useState<ActivityLevel>(body.activityLevel)
  const [pace, setPace] = useState(String(body.paceKg))
  const [manual, setManual] = useState(body.targetOverride != null)
  const [target, setTarget] = useState(dec(body.targetOverride))
  const [protein, setProtein] = useState(dec(body.proteinOverride))
  const [addBack, setAddBack] = useState(String(body.addBackPercent))

  useEffect(() => {
    if (body.configured && body.currentKg != null) setCurrent(dec(body.currentKg))
  }, [body.configured, body.currentKg])

  const kg = num(current)
  const goalKg = num(goal)
  const preview = kg != null && num(height) != null && num(birthYear) != null
    ? previewTargets({ sex, birthYear: num(birthYear)!, heightCm: num(height)!, kg, activityLevel: activity, paceKg: Number(pace) })
    : null
  const weeks = kg != null && goalKg != null && kg > goalKg && Number(pace) > 0 ? Math.ceil((kg - goalKg) / Number(pace)) : null
  const finalTarget = manual ? num(target) : preview?.target ?? null
  const valid = kg != null && goalKg != null && num(height) != null && num(birthYear) != null && (!manual || num(target) != null)

  async function onSave() {
    if (!valid) return
    await save.mutateAsync({
      sex,
      birthYear: num(birthYear)!,
      heightCm: num(height)!,
      goalKg: goalKg!,
      activityLevel: activity,
      paceKg: Number(pace),
      targetOverride: manual ? Math.round(num(target)!) : null,
      proteinOverride: num(protein) != null ? Math.round(num(protein)!) : null,
      addBackPercent: Number(addBack),
      currentKg: kg,
    })
    showToast('Zapisano cel')
    nav('/plan/postepy')
  }

  const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 64, borderBottom: '1px solid var(--border)' }
  const label: CSSProperties = { font: sans(15.5) }

  const field = (value: string, onChange: (v: string) => void, unit?: string, placeholder?: string) => (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, ...inputStyle, width: 120, justifyContent: 'flex-end', padding: '0 12px', alignContent: 'center' }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder={placeholder}
        style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'right', font: mono(16, 500), color: 'var(--text)', height: 44 }}
      />
      {unit && <span style={{ font: mono(12), color: 'var(--text-3)' }}>{unit}</span>}
    </span>
  )

  const stacked = (title: ReactNode, control: ReactNode, note?: ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={label}>{title}</span>
      {control}
      {note && <span style={{ font: mono(12), color: 'var(--text-2)' }}>{note}</span>}
    </div>
  )

  return (
    <div style={{ ...pad, paddingBottom: isMobile ? 150 : 64, maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <button type="button" onClick={() => nav(-1)} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, font: sans(14, 600), color: 'var(--text-2)', cursor: 'pointer' }}>← Wróć</button>
      <PageTitle
        title={id === own || !person ? 'Twój cel' : `Cel · ${person.name}`}
        sub="Kilka liczb, żeby policzyć dzienny budżet. Zmienisz je w każdej chwili."
        right={<PersonSwitch />}
      />

      <section>
        <Eyebrow tone="ink" style={{ display: 'block', paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>O tobie</Eyebrow>
        <div style={row}>
          <span style={label}>Płeć</span>
          <Segmented value={sex} onChange={setSex} style={{ width: 210 }} items={[{ key: 'female', label: 'Kobieta' }, { key: 'male', label: 'Mężczyzna' }]} />
        </div>
        <div style={row}><span style={label}>Rok urodzenia</span>{field(birthYear, setBirthYear)}</div>
        <div style={row}><span style={label}>Wzrost</span>{field(height, setHeight, 'cm')}</div>
        <div style={row}><span style={label}>Aktualna waga</span>{field(current, setCurrent, 'kg')}</div>
        <div style={row}><span style={label}>Waga docelowa</span>{field(goal, setGoal, 'kg')}</div>
        {stacked('Aktywność na co dzień', (
          <Segmented value={activity} onChange={setActivity} items={[
            { key: 'sedentary', label: 'siedząca' },
            { key: 'light', label: 'lekka' },
            { key: 'moderate', label: isMobile ? 'umiark.' : 'umiarkowana' },
            { key: 'high', label: 'wysoka' },
          ]} />
        ), 'bez treningów — te dolicza opaska')}
        {stacked('Tempo', (
          <Segmented value={pace} onChange={setPace} items={[
            { key: '0.25', label: '−0,25' },
            { key: '0.5', label: '−0,5' },
            { key: '0.75', label: '−0,75' },
          ]} />
        ), `kg na tydzień${weeks != null ? ` · ok. ${weeks} tygodni do celu` : ''}`)}
      </section>

      <section>
        <Eyebrow tone="ink" style={{ display: 'block', paddingBottom: 8 }}>Twój budżet</Eyebrow>
        <StatStrip
          stacked
          items={[
            { value: preview ? formatKcal(preview.bmr) : '—', label: 'podstawowa przemiana' },
            { value: preview ? formatKcal(preview.tdee) : '—', label: 'całkowita' },
            { value: finalTarget != null ? formatKcal(finalTarget) : '—', label: 'cel kcal', highlight: true },
          ]}
        />
        <Toggle on={manual} onChange={(v) => { setManual(v); if (v && !target && preview) setTarget(String(preview.target)) }} label="Ustaw cel ręcznie" />
        {manual && <div style={row}><span style={label}>Dzienny cel</span>{field(target, setTarget, 'kcal')}</div>}
        <div style={row}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={label}>Białko dziennie</span>
            <span style={{ font: mono(12), color: 'var(--text-3)' }}>puste = 1,6 g na kg wagi{preview ? ` (${preview.protein} g)` : ''}</span>
          </span>
          {field(protein, setProtein, 'g', preview ? String(preview.protein) : '')}
        </div>
        {stacked('Doliczaj aktywność z opaski', (
          <Segmented value={addBack} onChange={setAddBack} items={[{ key: '0', label: '0 %' }, { key: '50', label: '50 %' }, { key: '100', label: '100 %' }]} />
        ), 'Opaski zwykle zawyżają spalanie, dlatego domyślnie połowa.')}
        <p style={{ margin: '14px 0 0', font: sans(13), lineHeight: 1.5, color: 'var(--text-3)' }}>
          Szacunek ze wzoru Mifflina-St Jeora. Cel nie zejdzie poniżej {sex === 'male' ? '1 500' : '1 200'} kcal — przy mniejszym budżecie warto porozmawiać z lekarzem.
        </p>
      </section>

      {catering && <CateringSection catering={catering} />}

      {isMobile ? (
        <div data-pinned-bar style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`, zIndex: 20, padding: '12px 16px 10px', background: 'var(--bg)', boxShadow: '0 -1px 0 var(--border)' }}>
          <Button size="xl" style={{ width: '100%' }} disabled={!valid || save.isPending} onClick={onSave}>{save.isPending ? 'Zapisywanie…' : 'Zapisz cel'}</Button>
        </div>
      ) : (
        <Button size="lg" style={{ alignSelf: 'flex-start' }} disabled={!valid || save.isPending} onClick={onSave}>{save.isPending ? 'Zapisywanie…' : 'Zapisz cel'}</Button>
      )}
    </div>
  )
}

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd']

/**
 * Dieta pudełkowa: the average box day, counted as eaten on the delivery days from „od kiedy”.
 * Saved on its own (not with the goal); new numbers apply from today, past days keep theirs.
 */
function CateringSection({ catering }: { catering: Catering }) {
  const save = useSaveCatering()
  const [enabled, setEnabled] = useState(catering.configured ? catering.enabled : false)
  const [kcal, setKcal] = useState(catering.kcal ? String(catering.kcal) : '')
  const [protein, setProtein] = useState(dec(catering.protein))
  const [fat, setFat] = useState(dec(catering.fat))
  const [carbs, setCarbs] = useState(dec(catering.carbs))
  const [weekdays, setWeekdays] = useState(catering.weekdays)
  const [start, setStart] = useState(catering.startDate ?? toISO(new Date()))
  // „Ustawienia” on the day's catering block links here.
  useEffect(() => {
    if (window.location.hash === '#catering') document.getElementById('catering')?.scrollIntoView()
  }, [])

  const valid = !enabled || (num(kcal) != null && num(kcal)! > 0)
  const box: CSSProperties = { ...inputStyle, width: '100%', textAlign: 'right', font: mono(16, 500), height: 44, padding: '0 12px' }
  const cell = (title: string, value: string, onChange: (v: string) => void, unit?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>{unit ? `${title} · ${unit}` : title}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" style={box} />
    </label>
  )

  async function onSave() {
    if (!valid) return
    const r = (s: string) => (num(s) != null ? Math.round(num(s)! * 10) / 10 : null)
    await save.mutateAsync({
      enabled,
      kcal: num(kcal) != null ? Math.round(num(kcal)!) : 0,
      protein: r(protein),
      fat: r(fat),
      carbs: r(carbs),
      weekdays,
      startDate: start,
    })
    showToast('Zapisano catering')
  }

  return (
    <section id="catering" style={{ display: 'flex', flexDirection: 'column' }}>
      <Eyebrow tone="ink" style={{ display: 'block', paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>Catering</Eyebrow>
      <Toggle on={enabled} onChange={setEnabled} label="Jem catering (dieta pudełkowa)" />
      {enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '6px 0 14px' }}>
          <span style={{ font: sans(14), lineHeight: 1.5, color: 'var(--text-2)' }}>
            Średni dzień z pudełek. W dni dostawy wpisze się sam jako zjedzony — dopisujesz tylko to, co poza nim.
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            {cell('kcal', kcal, setKcal)}
            {cell('B', protein, setProtein, 'g')}
            {cell('W', carbs, setCarbs, 'g')}
            {cell('T', fat, setFat, 'g')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ font: sans(15.5) }}>Dni dostawy</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {WEEKDAYS.map((d, i) => (
                <Chip key={d} active={(weekdays & (1 << i)) !== 0} onClick={() => setWeekdays(weekdays ^ (1 << i))}>{d}</Chip>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ font: sans(15.5) }}>Od kiedy</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ ...inputStyle, width: 170, height: 44, font: mono(14), padding: '0 10px' }} />
          </label>
        </div>
      )}
      <Button variant="outline" style={{ alignSelf: 'flex-start', marginTop: 8 }} disabled={!valid || save.isPending} onClick={onSave}>
        {save.isPending ? 'Zapisywanie…' : 'Zapisz catering'}
      </Button>
    </section>
  )
}
