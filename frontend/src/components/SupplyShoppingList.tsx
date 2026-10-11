import { useState } from 'react'
import {
  useAuth, useSupplies, useAddSupply, useCheckSupply, useDeleteSupply,
  useClearCheckedSupplies, useClearSupplies, useUpdateHotSupply, useForgetHotSupply,
  useAllHotSupplies,
} from '../api/hooks'
import { supplyCategoryLabel } from '../lib/labels'
import { supplyGroups, suppliesAsText } from '../lib/supplies'
import { showToast } from '../lib/toastBus'
import { AddBar, CheckGroup, CheckRow, Progress, ShoppingFrame, useShoppingCounts, type ListAction } from './ShoppingFrame'
import { Button, Chip, Eyebrow, Sheet, sans } from './ui'

export function SupplyShoppingList() {
  const { canEdit } = useAuth()
  const { data, isLoading } = useSupplies()
  const counts = useShoppingCounts()
  const add = useAddSupply()
  const check = useCheckSupply()
  const remove = useDeleteSupply()
  const clear = useClearCheckedSupplies()
  const clearAll = useClearSupplies()
  const updateHot = useUpdateHotSupply()
  const forgetHot = useForgetHotSupply()
  const [name, setName] = useState('')
  const [managing, setManaging] = useState(false)

  const items = data?.items ?? []
  const hot = data?.hot ?? []
  const groups = supplyGroups(items)
  const total = data?.total ?? 0
  const done = data?.checkedCount ?? 0

  function submit() {
    if (!name.trim()) return
    add.mutate({ name: name.trim() })
    setName('')
  }

  async function copyList() {
    try {
      await navigator.clipboard.writeText(suppliesAsText(items))
      showToast('Skopiowano listę do schowka.')
    } catch {
      showToast('Nie udało się skopiować listy.')
    }
  }

  const actions: ListAction[] = [
    ...(items.some((s) => !s.checked) ? [{ label: 'Kopiuj listę', onClick: copyList }] : []),
    ...(canEdit && done > 0 ? [{ label: 'Usuń odhaczone', onClick: () => clear.mutate() }] : []),
    ...(canEdit ? [{ label: 'Zarządzaj częstymi', onClick: () => setManaging(true) }] : []),
    ...(canEdit && total > 0
      ? [{ label: 'Wyczyść listę', danger: true, onClick: () => { if (window.confirm(`Wyczyścić całą listę domową (pozycji: ${total})?`)) clearAll.mutate() } }]
      : []),
  ]

  return (
    <ShoppingFrame
      counts={counts}
      actions={actions}
      hint="Chemia, higiena, papier — osobna lista, bez związku ze spiżarnią. Częste rzeczy podpowiadamy na podstawie tego, co dodajesz."
      addBar={canEdit && <AddBar value={name} onChange={setName} onSubmit={submit} placeholder="Dodaj coś do domu…" />}
    >
      {canEdit && hot.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>Częste</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {hot.map((h) => (
              <Chip key={h.id} onClick={() => add.mutate({ name: h.name })} title={`Dodaj: ${h.name}`} style={h.pinned ? { borderColor: 'var(--rule)' } : undefined}>
                {h.pinned && '📌 '}+ {h.name}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <span style={{ color: 'var(--text-3)' }}>Ładowanie…</span>
      ) : items.length === 0 ? (
        <div style={{ padding: '28px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>Lista jest pusta</span>
          {canEdit && <span style={{ font: sans(14.5), color: 'var(--text-2)' }}>Dopisz coś ręcznie albo stuknij w częstą rzecz powyżej.</span>}
        </div>
      ) : (
        <>
          <Progress done={done} total={total} />
          {groups.map((g) => {
            const isChecked = g.key === 'checked'
            return (
              <CheckGroup key={g.key} thin={isChecked} label={isChecked ? `W koszyku · ${g.items.length}` : g.label}>
                {g.items.map((s, i) => (
                  <CheckRow
                    key={s.id}
                    checked={s.checked}
                    name={s.name}
                    onToggle={canEdit ? () => check.mutate(s.id) : undefined}
                    onRemove={canEdit && !s.checked ? () => remove.mutate(s.id) : undefined}
                    last={isChecked && i === g.items.length - 1}
                  />
                ))}
              </CheckGroup>
            )
          })}
        </>
      )}

      <Sheet open={managing} onClose={() => setManaging(false)} title="Częste rzeczy" width={560}>
        <HotManager onUpdate={updateHot.mutate} onForget={forgetHot.mutate} />
      </Sheet>
    </ShoppingFrame>
  )
}

/**
 * Pin / hide / forget the learned tallies. Lives in a sheet so the chip row stays a
 * one-tap affordance rather than a settings screen. It lists every entry, not just the
 * visible chips — otherwise there is no way to unhide something, or to pin something
 * currently ranked below the cap.
 */
function HotManager({ onUpdate, onForget }: {
  onUpdate: (args: { id: string; pinned?: boolean; hidden?: boolean }) => void
  onForget: (id: string) => void
}) {
  const { data, isLoading } = useAllHotSupplies(true)

  if (isLoading) return <span style={{ color: 'var(--text-3)' }}>Ładowanie…</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {(data ?? []).map((h) => (
        <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)', opacity: h.hidden ? 0.55 : 1 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: sans(14.5, 600) }}>{h.name}</span>
            <span style={{ font: sans(12), color: 'var(--text-3)' }}>
              {supplyCategoryLabel[h.category]} · dodane {h.count}×{h.hidden && ' · ukryte'}
            </span>
          </div>
          <Button size="sm" variant={h.pinned ? 'dark' : 'quiet'} style={{ height: 32, font: sans(12.5, 600) }} onClick={() => onUpdate({ id: h.id, pinned: !h.pinned })}>
            {h.pinned ? 'Przypięte' : 'Przypnij'}
          </Button>
          <Button size="sm" variant="quiet" style={{ height: 32, font: sans(12.5, 600) }} onClick={() => onUpdate({ id: h.id, hidden: !h.hidden })}>
            {h.hidden ? 'Pokaż' : 'Ukryj'}
          </Button>
          <button
            type="button"
            title="Zapomnij razem ze statystykami"
            onClick={() => {
              if (window.confirm(`Zapomnieć „${h.name}” i jego statystyki?`)) onForget(h.id)
            }}
            style={{ border: 0, background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
