import { useNavigate } from 'react-router-dom'
import type { FirstStepKey } from '../api/client'
import { useChatHealth, useDismissFirstSteps, useFirstSteps } from '../api/hooks'
import { requestChat } from '../lib/chatBus'
import { CheckMark } from './icons'
import { mono, sans } from './ui'

const COPY: Record<FirstStepKey, { title: string; hint: string; to?: string }> = {
  profile: { title: 'Wypełnij profil kulinarny', hint: 'Smaki, sprzęt i czego unikać — przepisy i Sous dopasują się do was.', to: '/profile/ankieta' },
  pantry: { title: 'Zaznacz, co masz w spiżarni', hint: 'Wystarczy z grubsza — przepisy i zakupy pokażą, czego brakuje.', to: '/pantry' },
  recipe: { title: 'Dodaj pierwszy własny przepis', hint: 'Z linku, zdjęcia albo ręcznie.', to: '/add' },
  plan: { title: 'Zaplanuj pierwszy posiłek', hint: 'Plan to też dziennik — odhaczasz, co zjedzone.', to: '/plan' },
  invite: { title: 'Zaproś domownika', hint: 'Kod dołączenia jest w Profil → Domownicy.', to: '/profile' },
  goal: { title: 'Ustaw swój cel', hint: 'Kcal i makro na dzień — tylko jeśli chcesz liczyć.', to: '/profile/cel' },
  training: { title: 'Wypełnij ankietę treningową', hint: 'Plan ćwiczeń pod twój czas i sprzęt.', to: '/trening/ankieta' },
  sous: { title: 'Zapytaj o coś Sous', hint: 'Np. co ugotować z tego, co masz — albo wklej link do przepisu.' },
}

/**
 * „Pierwsze kroki” — shown on the recipe library to someone new to a kitchen until they dismiss it
 * or finish the required steps. Steps tick themselves (server-side, from real data).
 */
export function FirstStepsCard() {
  const { data } = useFirstSteps()
  const { data: chat } = useChatHealth()
  const dismiss = useDismissFirstSteps()
  const nav = useNavigate()
  if (!data?.show) return null

  const steps = data.steps
  const done = steps.filter((s) => s.done).length
  // With Sous on, the recipe step points at the fastest way in: a pasted link.
  const recipeHint = chat?.enabled ? 'Wklej link w czacie Sous albo dodaj ręcznie — z linku, zdjęcia lub PDF-a.' : COPY.recipe.hint

  return (
    <section aria-label="Pierwsze kroki" style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '14px 0 10px' }}>
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 22 }}>Pierwsze kroki</span>
        <span style={{ font: mono(12), color: 'var(--text-2)' }}>{done}/{steps.length}</span>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((s) => {
          const copy = COPY[s.key]
          const go = () => (s.key === 'sous' ? requestChat() : copy.to && nav(copy.to))
          return (
            <li key={s.key} style={{ borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={go}
                disabled={s.done}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', border: 0, background: 'transparent', textAlign: 'left', color: 'var(--text)', cursor: s.done ? 'default' : 'pointer' }}
              >
                <span aria-hidden style={{ flex: '0 0 22px', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: s.done ? 0 : '1px solid var(--rule)', background: s.done ? 'var(--accent)' : 'transparent' }}>
                  {s.done && <CheckMark size={13} color="#fff" />}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: sans(15, 500), color: s.done ? 'var(--text-3)' : 'var(--text)', textDecoration: s.done ? 'line-through' : 'none' }}>
                    {copy.title}
                    {s.optional && <span style={{ font: mono(11), color: 'var(--text-3)', marginLeft: 8, textDecoration: 'none', display: 'inline-block' }}>opcjonalnie</span>}
                  </span>
                  {!s.done && <span style={{ font: sans(13.5), color: 'var(--text-2)', lineHeight: 1.4 }}>{s.key === 'recipe' ? recipeHint : copy.hint}</span>}
                </span>
                {!s.done && <span aria-hidden style={{ flex: 'none', font: sans(16), color: 'var(--text-3)' }}>→</span>}
              </button>
            </li>
          )
        })}
      </ol>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 0 12px', borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
          style={{ border: 0, background: 'transparent', padding: '6px 0', font: sans(13, 500), color: 'var(--text-2)', cursor: 'pointer' }}
        >
          Ukryj — poradzę sobie
        </button>
      </div>
    </section>
  )
}
