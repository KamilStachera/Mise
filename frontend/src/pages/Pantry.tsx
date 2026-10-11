import { useMemo, useState } from 'react'
import { useAuth, usePantry, useAddPantry, useUpdatePantry, useDeletePantry, useAddShopping, useShopping } from '../api/hooks'
import { useIsMobile } from '../lib/useIsMobile'
import type { PantryItem, Unit } from '../api/client'
import { categoryLabel, formatQty, plural, unitLabel, UNITS } from '../lib/labels'
import { showToast } from '../lib/toastBus'
import { Button, Chip, Eyebrow, PageTitle, SearchField, SectionHead, Sheet, StatStrip, StatusDot, inputStyle, mono, sans, usePagePad } from '../components/ui'

const CATS = ['Produce', 'Fridge', 'Pantry', 'Spices']

type StatusFilter = 'all' | 'in' | 'low' | 'out'

/** Parse a user-typed amount ("1,5" or "1.5"); NaN-safe. */
function parseAmount(s: string): number | null {
  if (!s.trim()) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function norm(s: string): string {
  return s.toLocaleLowerCase('pl-PL').trim()
}

export function Pantry() {
  const { canEdit } = useAuth()
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { data: groups = [], isLoading } = usePantry()
  const { data: shopping } = useShopping()
  const addShopping = useAddShopping()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<PantryItem | null>(null)
  const [activeCat, setActiveCat] = useState<string | null>(null)

  const all = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const counts = useMemo(
    () => ({
      all: all.length,
      in: all.filter((i) => i.status === 'in').length,
      low: all.filter((i) => i.status === 'low').length,
      out: all.filter((i) => i.status === 'out').length,
    }),
    [all],
  )
  // Names already waiting on the food list — no second "+ do zakupów" for them.
  const onList = useMemo(
    () => new Set((shopping?.items ?? []).filter((s) => !s.checked).map((s) => norm(s.name))),
    [shopping],
  )

  const q = norm(query)
  const visible = groups
    .map((g) => ({
      category: g.category,
      items: g.items.filter(
        (i) => (status === 'all' || i.status === status) && (!q || norm(i.name).includes(q) || i.aliases.some((a) => norm(a).includes(q))),
      ),
    }))
    .filter((g) => g.items.length > 0)

  const toggleStatus = (s: StatusFilter) => setStatus((cur) => (cur === s ? 'all' : s))

  async function toShopping(item: PantryItem) {
    await addShopping.mutateAsync({ name: item.name })
    showToast(`Dodano do zakupów: ${item.name}`)
  }

  function jump(category: string) {
    setActiveCat(category)
    document.getElementById(`pantry-${category}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const strip = (
    <StatStrip
      items={[
        ...(isMobile ? [] : [{ value: counts.all, label: 'Wszystko', active: status === 'all', onClick: () => setStatus('all') }]),
        { value: counts.in, label: <><StatusDot status="in" size={isMobile ? 7 : 8} />Jest</>, active: status === 'in', onClick: () => toggleStatus('in') },
        { value: counts.low, label: <><StatusDot status="low" size={isMobile ? 7 : 8} />Mało</>, active: status === 'low', onClick: () => toggleStatus('low') },
        { value: counts.out, label: <><StatusDot status="out" size={isMobile ? 7 : 8} />Brak</>, highlight: true, active: status === 'out', onClick: () => toggleStatus('out') },
      ]}
    />
  )

  const sections = isLoading ? (
    <span style={{ color: 'var(--text-3)' }}>Ładowanie…</span>
  ) : visible.length === 0 ? (
    <span style={{ font: sans(15), color: 'var(--text-2)', padding: '12px 0' }}>Nic nie pasuje — zmień wyszukiwanie albo filtr.</span>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 24 : 36 }}>
      {visible.map((g) => (
        <div key={g.category} id={`pantry-${g.category}`} style={{ display: 'flex', flexDirection: 'column', scrollMarginTop: 16 }}>
          <SectionHead title={categoryLabel(g.category)} size={isMobile ? 20 : 22} meta={isMobile ? g.items.length : plural(g.items.length, 'produkt', 'produkty', 'produktów')} />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', columnGap: 40 }}>
            {g.items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                canEdit={canEdit}
                onList={onList.has(norm(it.name))}
                onOpen={() => canEdit && setEditing(it)}
                onShop={() => toShopping(it)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )

  const subtitle = canEdit
    ? 'Ilości ze znakiem ~ są szacunkami. Przed zakupami aplikacja poprosi tylko o potrzebne korekty.'
    : 'Podgląd tylko do odczytu — zaloguj się, aby zmieniać stany.'

  const sheets = (
    <>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Nowy produkt">
        <AddForm onDone={() => setAdding(false)} />
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.name}>
        {editing && <ItemEditor key={editing.id} item={editing} onClose={() => setEditing(null)} />}
      </Sheet>
    </>
  )

  if (isMobile) {
    return (
      <div style={{ ...pad, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PageTitle title="Spiżarnia" right={canEdit && <Button variant="outline" size="sm" onClick={() => setAdding(true)}>+ Produkt</Button>} />
        <p style={{ margin: 0, font: sans(14), lineHeight: 1.45, color: 'var(--text-2)' }}>{subtitle}</p>
        {strip}
        <SearchField value={query} onChange={setQuery} placeholder="Szukaj w spiżarni" />
        {sections}
        {sheets}
      </div>
    )
  }

  return (
    <div style={{ ...pad, maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <PageTitle
        title="Spiżarnia"
        sub={subtitle}
        right={
          <div style={{ display: 'flex', gap: 10 }}>
            <SearchField value={query} onChange={setQuery} placeholder="Szukaj w spiżarni" style={{ width: 280 }} />
            {canEdit && <Button variant="outline" onClick={() => setAdding(true)}>+ Dodaj produkt</Button>}
          </div>
        }
      />
      {strip}
      <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 48, alignItems: 'start' }}>
        <nav style={{ position: 'sticky', top: 24, display: 'flex', flexDirection: 'column' }}>
          {groups.map((g) => {
            const on = (activeCat ?? groups[0]?.category) === g.category
            const shown = visible.find((v) => v.category === g.category)?.items.length ?? 0
            return (
              <button
                key={g.category}
                type="button"
                onClick={() => jump(g.category)}
                disabled={shown === 0}
                style={{
                  height: 38,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 0 0 12px',
                  border: 0,
                  background: 'transparent',
                  cursor: shown ? 'pointer' : 'default',
                  font: sans(14.5, on ? 600 : 500),
                  color: on ? 'var(--text)' : 'var(--text-2)',
                  boxShadow: on ? 'inset 3px 0 0 var(--accent)' : undefined,
                  opacity: shown ? 1 : 0.4,
                  textAlign: 'left',
                }}
              >
                {categoryLabel(g.category)}
                <span style={{ font: mono(12), color: 'var(--text-2)' }}>{shown}</span>
              </button>
            )
          })}
        </nav>
        {sections}
      </div>
      {sheets}
    </div>
  )
}

function ItemRow({ item, canEdit, onList, onOpen, onShop }: {
  item: PantryItem
  canEdit: boolean
  onList: boolean
  onOpen: () => void
  onShop: () => void
}) {
  const isMobile = useIsMobile()
  const out = item.status === 'out'
  return (
    <div
      onClick={onOpen}
      style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: isMobile ? 52 : 54, padding: '6px 0', borderBottom: '1px solid var(--border)', cursor: canEdit ? 'pointer' : 'default' }}
    >
      <StatusDot status={item.status} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ font: sans(15.5) }}>{item.name}</span>
        {item.confidence === 'stale' && !out && <span style={{ font: sans(11.5), color: 'var(--accent-text)' }}>sprawdź przy zakupach</span>}
      </span>
      {out ? (
        onList ? (
          <span style={{ font: sans(12.5, 600), color: 'var(--sage-text)' }}>na liście ✓</span>
        ) : canEdit ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onShop()
            }}
            style={{ height: isMobile ? 32 : 30, padding: '0 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', font: sans(12.5, 600), color: 'var(--text)', whiteSpace: 'nowrap' }}
          >
            + do zakupów
          </button>
        ) : (
          <span style={{ font: mono(13), color: 'var(--text-3)' }}>brak</span>
        )
      ) : (
        <span style={{ font: mono(13), color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
          {item.confidence === 'confirmed' ? '' : '~'}{formatQty(item.quantity, item.unit)}
        </span>
      )}
    </div>
  )
}

function AddForm({ onDone }: { onDone: () => void }) {
  const add = useAddPantry()
  const [name, setName] = useState('')
  const [cat, setCat] = useState('Produce')
  const [unit, setUnit] = useState<Unit>('szt')
  const [startQty, setStartQty] = useState('')

  async function submit() {
    if (!name.trim()) return
    try {
      await add.mutateAsync({ name: name.trim(), category: cat, unit, quantity: parseAmount(startQty) ?? 0 })
      showToast(`Dodano do spiżarni: ${name.trim()}`)
      onDone()
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('409')) {
        alert('Taki produkt już jest w katalogu — znajdź go na liście i zmień ilość.')
      } else {
        alert('Nie udało się dodać produktu.')
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Nazwa produktu…" style={inputStyle} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Eyebrow>Kategoria</Eyebrow>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CATS.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{categoryLabel(c)}</Chip>)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>Jednostka</Eyebrow>
          <div style={{ display: 'flex', gap: 6 }}>
            {UNITS.map((u) => <Chip key={u} active={unit === u} onClick={() => setUnit(u)}>{unitLabel[u]}</Chip>)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>Ilość w domu</Eyebrow>
          <input value={startQty} onChange={(e) => setStartQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="0" inputMode="decimal" style={{ ...inputStyle, width: 110, height: 38, font: mono(14) }} />
        </div>
      </div>
      <Button size="xl" onClick={submit} disabled={!name.trim() || add.isPending}>{add.isPending ? 'Dodawanie…' : 'Dodaj do spiżarni'}</Button>
    </div>
  )
}

function ItemEditor({ item, onClose }: { item: PantryItem; onClose: () => void }) {
  const update = useUpdatePantry()
  const remove = useDeletePantry()
  const [qty, setQty] = useState(String(item.quantity).replace('.', ','))
  const [threshold, setThreshold] = useState(item.lowThreshold != null ? String(item.lowThreshold).replace('.', ',') : '')
  const step = item.unit === 'szt' ? 1 : 50

  function bump(delta: number) {
    const current = parseAmount(qty) ?? 0
    setQty(String(Math.max(0, current + delta)).replace('.', ','))
  }

  async function save() {
    await update.mutateAsync({
      id: item.id,
      input: {
        name: item.name,
        category: item.category,
        unit: item.unit,
        quantity: Math.max(0, parseAmount(qty) ?? 0),
        lowThreshold: parseAmount(threshold),
        aliases: item.aliases,
      },
    })
    onClose()
  }

  async function del() {
    if (!confirm(`Usunąć „${item.name}” z katalogu spiżarni? Zwykle lepiej wyzerować ilość.`)) return
    await remove.mutateAsync(item.id)
    onClose()
  }

  const stepBtn = { width: 64, flex: '0 0 64px', height: 46, font: mono(14, 500) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <span style={{ font: sans(13.5), color: 'var(--text-2)' }}>
        {categoryLabel(item.category)}
        {item.confidence !== 'confirmed' && ` · ${item.confidence === 'stale' ? 'dawno nie sprawdzane' : 'ilość szacunkowa'}`}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Eyebrow>Ilość ({unitLabel[item.unit]})</Eyebrow>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant="quiet" style={stepBtn} onClick={() => bump(-step)}>−{step}</Button>
          <input value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} inputMode="decimal" style={{ ...inputStyle, flex: 1, textAlign: 'center', font: mono(18, 500) }} />
          <Button variant="quiet" style={stepBtn} onClick={() => bump(step)}>+{step}</Button>
        </div>
        <Button variant="text" style={{ alignSelf: 'flex-start', font: sans(13.5, 600) }} onClick={() => setQty('0')}>Wyzeruj — nie ma w domu</Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ font: sans(14), color: 'var(--text-2)', flex: 1 }}>Próg „mało” (poniżej — status Mało)</span>
        <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="brak" inputMode="decimal" style={{ ...inputStyle, width: 100, height: 40, textAlign: 'center', font: mono(14) }} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button onClick={save} disabled={update.isPending}>{update.isPending ? 'Zapisywanie…' : 'Zapisz'}</Button>
        <Button variant="quiet" onClick={onClose}>Anuluj</Button>
        <span style={{ flex: 1 }} />
        <Button variant="text" style={{ color: 'var(--accent-text)' }} onClick={del}>Usuń z katalogu</Button>
      </div>
    </div>
  )
}
