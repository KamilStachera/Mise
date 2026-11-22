import { Chip, Eyebrow, Toggle, sans } from '../components/ui'
import { CATEGORIES, CATEGORY_LABEL, PARTS, PART_LABEL, type Category, type Difficulty, type Part } from './types'
import type { Filters } from './queue'

const DIFFICULTIES: readonly { value: Difficulty; label: string }[] = [
  { value: 1, label: 'Łatwe' },
  { value: 2, label: 'Średnie' },
  { value: 3, label: 'Trudne' },
]

function toggle<T>(xs: T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  )
}

export function FiltersPanel({ value, onChange, poolSize }: { value: Filters; onChange: (f: Filters) => void; poolSize: number }) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Row label="Część">
        <Chip active={value.parts.length === 0} onClick={() => set({ parts: [] })}>Wszystkie</Chip>
        {PARTS.map((p: Part) => (
          <Chip key={p} active={value.parts.includes(p)} onClick={() => set({ parts: toggle(value.parts, p) })}>
            {PART_LABEL[p]}
          </Chip>
        ))}
      </Row>
      <Row label="Poziom trudności">
        <Chip active={value.difficulties.length === 0} onClick={() => set({ difficulties: [] })}>Wszystkie</Chip>
        {DIFFICULTIES.map((d) => (
          <Chip
            key={d.value}
            active={value.difficulties.includes(d.value)}
            onClick={() => set({ difficulties: toggle(value.difficulties, d.value) })}
          >
            {d.label}
          </Chip>
        ))}
      </Row>
      <Row label="Źródło">
        <Chip active={value.source === 'all'} onClick={() => set({ source: 'all' })}>Wszystko</Chip>
        <Chip active={value.source === 'film'} onClick={() => set({ source: 'film' })}>Filmy</Chip>
        <Chip active={value.source === 'ksiazka'} onClick={() => set({ source: 'ksiazka' })}>Książki</Chip>
      </Row>
      <Row label="Kategoria">
        <Chip active={value.categories.length === 0} onClick={() => set({ categories: [] })}>Wszystkie</Chip>
        {CATEGORIES.map((c: Category) => (
          <Chip key={c} active={value.categories.includes(c)} onClick={() => set({ categories: toggle(value.categories, c) })}>
            {CATEGORY_LABEL[c]}
          </Chip>
        ))}
      </Row>
      <div>
        <Toggle on={value.mistakesOnly} onChange={(v) => set({ mistakesOnly: v })} label="Tylko do poprawy (ostatnio błędne)" />
      </div>
      <div style={{ font: sans(14), color: poolSize ? 'var(--text-2)' : 'var(--accent-text)' }}>
        {poolSize ? `W puli: ${poolSize} ${plural(poolSize)}` : 'Żadne pytanie nie pasuje do filtrów.'}
      </div>
    </div>
  )
}

export function plural(n: number) {
  if (n === 1) return 'pytanie'
  const d = n % 10
  const t = n % 100
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? 'pytania' : 'pytań'
}
