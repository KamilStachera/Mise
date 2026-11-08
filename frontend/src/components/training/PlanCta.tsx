import { useNavigate } from 'react-router-dom'
import { useChatHealth } from '../../api/hooks'
import { useTrainingProfile } from '../../api/training'
import { requestChat } from '../../lib/chatBus'
import { Button, mono, sans } from '../ui'

export const SOUS_PLAN_PROMPT =
  'Ułóż mi plan treningowy według mojej ankiety treningowej (zasady w AGENTS.md, sekcje „Trening”). ' +
  'Najpierw pokaż propozycję: podział tygodnia, tydzień 1 i jak plan rośnie.'

export const SOUS_ADJUST_PROMPT =
  'Dostosuj mój aktywny plan treningowy na kolejne tygodnie (zasady w AGENTS.md, sekcje „Trening”). ' +
  'Najpierw zapytaj, co chcę zmienić, i pokaż propozycję.'

/** No active program: questionnaire first, then "ask Sous" (or /plan-treningowy in Claude Code). */
export function PlanCta({ finished }: { finished?: boolean }) {
  const nav = useNavigate()
  const { data: profile } = useTrainingProfile()
  const { data: chat } = useChatHealth()
  const configured = profile?.configured ?? false

  return (
    <section style={{ border: '1px solid var(--rule)', borderRadius: 16, padding: '22px 22px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
      <span style={{ font: mono(10.5, 500), letterSpacing: '.1em', color: 'var(--text-3)' }}>
        {finished ? 'PLAN ZAKOŃCZONY' : configured ? 'KROK 2 Z 2' : 'KROK 1 Z 2'}
      </span>
      <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 28, lineHeight: 1.1 }}>
        {finished ? 'Brawo! Czas na kolejny plan' : configured ? 'Ułóż plan treningowy' : 'Zacznij od krótkiej ankiety'}
      </span>
      <p style={{ margin: 0, font: sans(14.5), color: 'var(--text-2)', lineHeight: 1.5 }}>
        {configured
          ? 'Sous dobierze ćwiczenia do Twojego celu, sprzętu i czasu, rozpisze tygodnie z progresją i pokaże propozycję do akceptacji.'
          : 'Cel, ile dni i minut, gdzie ćwiczysz, jaki masz sprzęt i czego unikać — na tej podstawie powstanie plan.'}
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {configured ? (
          <>
            {chat?.enabled && <Button onClick={() => requestChat(finished ? SOUS_ADJUST_PROMPT : SOUS_PLAN_PROMPT)}>✦ Ułóż plan z Sous</Button>}
            <Button variant="quiet" onClick={() => nav('/trening/ankieta')}>Zmień ankietę</Button>
          </>
        ) : (
          <Button onClick={() => nav('/trening/ankieta')}>Wypełnij ankietę</Button>
        )}
      </div>
      {configured && (
        <p style={{ margin: 0, font: sans(12.5), color: 'var(--text-3)' }}>
          Albo w Claude Code / Codex: <code style={{ font: mono(12, 500) }}>/plan-treningowy</code>. Polskie opisy i filmy
          ćwiczeń z planu aplikacja dopisze sama w ciągu kilku minut.
        </p>
      )}
    </section>
  )
}
