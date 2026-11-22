import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError, type StravaStatus, type SyncState, type Workout } from '../../api/client'
import {
  useActivity, useAuth, useBody, useConnectStrava, useDeleteWorkout, useDisconnectStrava, useHealthConnection,
  useRotateHealthConnection, useStravaStatus, useSyncStrava,
} from '../../api/hooks'
import { SourceTag } from '../../components/diary/parts'
import { PersonSwitch } from '../../components/diary/PersonSwitch'
import { WorkoutSheet } from '../../components/diary/WorkoutSheet'
import { SousButton } from '../../components/SousButton'
import { TAB_BAR_HEIGHT } from '../../components/TabBar'
import { Button, Eyebrow, PageTitle, Sheet, mono, sans, usePagePad } from '../../components/ui'
import { WEEKDAY_SHORT, dayShortMonth, hhmm, parseISODate, syncLabel } from '../../lib/dates'
import { formatKcal } from '../../lib/labels'
import { showToast } from '../../lib/toastBus'
import { useIsMobile } from '../../lib/useIsMobile'
import { PrivateDiary } from './DayView'

const CHAIN = 'Opaska / waga → Mi Fitness → Health Connect → HC Webhook → Pichci'
const STRAVA_CHAIN = 'Zegarek → Garmin Connect / Polar Flow / … → Strava → Pichci'

/** What the Strava redirect brings back in ?strava=… (StravaEndpoints callback). */
const STRAVA_RESULT: Record<string, string> = {
  connected: 'Strava połączona — treningi z ostatniego tygodnia już są',
  denied: 'Nie połączono ze Stravą',
  scope: 'Strava: zostaw zaznaczony dostęp do aktywności (także prywatnych) i spróbuj jeszcze raz',
  taken: 'To konto Strava jest już połączone z inną osobą',
  error: 'Nie udało się połączyć ze Stravą — spróbuj jeszcze raz',
}

function workoutsCount(n: number): string {
  const tens = n % 100
  const ones = n % 10
  return `${n} ${n === 1 ? 'trening' : ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'treningi' : 'treningów'}`
}

/**
 * Plan → Aktywność: data-first hero ledger (today's active kcal, budget bonus, workouts),
 * followed by the last 7 days, with band/Strava connection setup neatly tucked in a Sheet.
 */
export function ActivityView() {
  const isMobile = useIsMobile()
  const pad = usePagePad()
  const { canEdit, isLoading, data: me } = useAuth()
  const { data: activity, refetch, isFetching } = useActivity(7)
  const { data: body } = useBody()
  const del = useDeleteWorkout()
  const [sheet, setSheet] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const { data: strava } = useStravaStatus(canEdit)
  const [params, setParams] = useSearchParams()

  // Back from Strava's consent screen: say how it went once, then drop the parameter.
  useEffect(() => {
    const result = params.get('strava')
    if (!result) return
    showToast(STRAVA_RESULT[result] ?? STRAVA_RESULT.error)
    const next = new URLSearchParams(params)
    next.delete('strava')
    setParams(next, { replace: true })
  }, [params, setParams])

  if (!canEdit && !isLoading) return <PrivateDiary switcher={null} />

  const state: SyncState = activity?.state ?? 'none'
  const today = activity?.days[0]
  const addBack = activity?.addBackPercent ?? body?.addBackPercent ?? 50
  const addBackText = addBack === 50 ? 'połowa do budżetu' : addBack === 0 ? 'nie doliczane do budżetu' : `${addBack}% do budżetu`

  const deviceSummary = (() => {
    const parts: string[] = []
    if (state === 'connected') parts.push(`Opaska połączona${activity?.lastSyncAt ? ` · ${syncLabel(activity.lastSyncAt)}` : ''}`)
    else if (state === 'stale') parts.push(`Opaska: brak danych od ${activity?.lastSyncAt ? syncLabel(activity.lastSyncAt) : 'dawna'}`)
    if (strava?.connected) parts.push(`Strava${strava.athleteName ? ` (${strava.athleteName})` : ''}`)
    if (parts.length === 0) return 'Opaska i Strava niepodłączone'
    return parts.join(' · ')
  })()

  return (
    <div style={{ ...pad, paddingBottom: isMobile ? 120 : 64, maxWidth: isMobile ? undefined : 1200, margin: '0 auto' }}>
      <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: isMobile ? 20 : 26 }}>
        <PageTitle
          eyebrow="Plan"
          title="Aktywność"
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <PersonSwitch />
              {!isMobile && <Button onClick={() => setSheet(true)}>+ Dodaj trening</Button>}
            </div>
          }
        />

        {state === 'stale' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 14px', borderTop: '1px solid var(--gold)', borderBottom: '1px solid var(--gold)', background: 'var(--gold-soft)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: sans(14, 500) }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
              Brak danych z opaski od {activity?.lastSyncAt ? syncLabel(activity.lastSyncAt) : 'dawna'}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>Sprawdź</Button>
              <Button variant="text" size="sm" style={{ color: 'var(--text)' }} onClick={() => setDevicesOpen(true)}>Ustawienia ›</Button>
            </div>
          </div>
        )}

        {today && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Eyebrow>Dziś · {dayShortMonth(parseISODate(today.date))}</Eyebrow>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ font: mono(isMobile ? 48 : 60, 500), letterSpacing: '-0.04em', lineHeight: 1 }}>
                    {today.activeKcal > 0 ? formatKcal(today.activeKcal) : '0'}
                  </span>
                  <span style={{ font: mono(isMobile ? 14 : 16), color: 'var(--text-3)' }}>kcal aktywnych</span>
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'flex-start' : 'flex-end', gap: 3, paddingBottom: 4 }}>
                <span style={{ font: mono(isMobile ? 16 : 18, 600), color: today.bonus > 0 ? 'var(--accent-text)' : 'var(--text-2)' }}>
                  +{formatKcal(today.bonus)} kcal do budżetu
                </span>
                <span style={{ font: mono(12), color: 'var(--text-3)' }}>
                  {workoutsCount(today.workouts.length)} · {addBackText}
                </span>
              </div>
            </div>

            {today.workouts.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border)' }}>
                {today.workouts.map((w) => <WorkoutRow key={w.id} w={w} onDelete={() => del.mutate(w.id)} />)}
              </div>
            ) : (
              <span style={{ font: sans(14), color: 'var(--text-3)', paddingTop: 4 }}>
                Brak zapisanych treningów dziś.
              </span>
            )}
          </section>
        )}

        {activity && activity.days.length > 1 && (
          <section style={{ display: 'flex', flexDirection: 'column' }}>
            <Eyebrow tone="ink" style={{ paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}>Ostatnie 7 dni</Eyebrow>
            {activity.days.slice(1).map((d) => {
              const date = parseISODate(d.date)
              return (
                <div key={d.date} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 19 }}>
                      {WEEKDAY_SHORT[(date.getDay() + 6) % 7]} <span style={{ fontStyle: 'italic', color: 'var(--text-3)' }}>{dayShortMonth(date)}</span>
                    </span>
                    <span style={{ font: mono(13.5, 500) }}>{d.activeKcal > 0 ? `${formatKcal(d.activeKcal)} kcal` : '—'}</span>
                  </div>
                  {d.workouts.map((w) => (
                    <span key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, font: sans(14), color: 'var(--text-2)' }}>
                      {w.type} · {w.minutes} min <SourceTag band={w.source === 'band'} strava={w.source === 'strava'} training={w.source === 'training'} />
                    </span>
                  ))}
                </div>
              )
            })}
          </section>
        )}

        <button
          type="button"
          onClick={() => setDevicesOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            width: '100%',
            padding: '14px 0',
            border: 0,
            borderTop: '1px solid var(--rule)',
            borderBottom: '1px solid var(--border)',
            background: 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            color: 'var(--text)',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: 20 }}>Urządzenia i połączenia</span>
            <span style={{ font: mono(12), color: 'var(--text-2)' }}>{deviceSummary}</span>
          </span>
          <span style={{ fontSize: 18, color: 'var(--text-2)', flexShrink: 0 }}>›</span>
        </button>

        {isMobile && (
          <div
            data-pinned-bar
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
              zIndex: 20,
              padding: '10px 16px',
              background: 'var(--bg)',
              borderTop: '1px solid var(--rule)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Button size="xl" style={{ flex: 1 }} onClick={() => setSheet(true)}>
              {state === 'none' && !strava?.connected ? '+ Dodaj trening ręcznie' : '+ Dodaj trening'}
            </Button>
            <SousButton variant="bar" />
          </div>
        )}

        <WorkoutSheet open={sheet} onClose={() => setSheet(false)} weightKg={body?.currentKg ?? null} addBackPercent={addBack} />

        <Sheet open={devicesOpen} onClose={() => setDevicesOpen(false)} title="Urządzenia i połączenia" width={540}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {strava && <StravaCard status={strava} isAdmin={!!me?.isAdmin} divider="bottom" />}
            <BandCard state={state} lastSyncAt={activity?.lastSyncAt ?? null} onRefresh={() => refetch()} refreshing={isFetching} />
            <Setup />
          </div>
        </Sheet>
      </div>
    </div>
  )
}

function BandCard({ state, lastSyncAt, onRefresh, refreshing }: {
  state: SyncState
  lastSyncAt: string | null
  onRefresh: () => void
  refreshing: boolean
}) {
  if (state === 'stale') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: sans(16, 600) }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)' }} />
          Opaska · brak danych od {lastSyncAt ? syncLabel(lastSyncAt) : 'dawna'}
        </span>
        <span style={{ font: sans(14), lineHeight: 1.5, color: 'var(--text-2)' }}>
          Otwórz Mi Fitness na telefonie, a dane same dojdą. Jeśli nie, sprawdź, czy HC Webhook działa w tle.
        </span>
        <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>{CHAIN}</span>
        <Button variant="outline" size="sm" style={{ alignSelf: 'flex-start' }} onClick={onRefresh} disabled={refreshing}>
          Sprawdź ponownie
        </Button>
      </div>
    )
  }
  if (state === 'connected') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: sans(16, 600) }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sage)' }} />
            Opaska połączona
          </span>
          {lastSyncAt && <span style={{ font: mono(12), color: 'var(--text-2)' }}>ostatnia synchronizacja {syncLabel(lastSyncAt)}</span>}
        </div>
        <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>{CHAIN}</span>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: sans(16, 600) }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--text-2)', boxSizing: 'border-box' }} />
        Opaska niepodłączona
      </span>
      <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>{CHAIN}</span>
    </div>
  )
}

function WorkoutRow({ w, onDelete }: { w: Workout; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ font: sans(16, 500) }}>{w.type}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, font: mono(12), color: 'var(--text-2)' }}>
          {w.minutes} min{w.startedAt ? ` · ${hhmm(w.startedAt)}` : ''} <SourceTag band={w.source === 'band'} strava={w.source === 'strava'} training={w.source === 'training'} />
        </span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: mono(14, 500) }}>{w.kcal != null ? `${formatKcal(w.kcal)} kcal` : '—'}</span>
        {w.source === 'manual' && (
          <button type="button" aria-label={`Usuń trening ${w.type}`} onClick={onDelete} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16, padding: '4px 6px' }}>×</button>
        )}
      </span>
    </div>
  )
}

function StravaCard({ status, isAdmin, divider }: { status: StravaStatus; isAdmin: boolean; divider: 'top' | 'bottom' }) {
  const connect = useConnectStrava()
  const sync = useSyncStrava()
  const disconnect = useDisconnectStrava()
  const fail = (e: unknown) => showToast(e instanceof ApiError && e.detail ? e.detail : 'Strava nie odpowiada — spróbuj za chwilę')
  const wrap = divider === 'top'
    ? { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 14, borderTop: '1px solid var(--border)' } as const
    : { display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 14, borderBottom: '1px solid var(--border)' } as const

  if (!status.connected) {
    return (
      <div style={wrap}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: sans(16, 600) }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--text-2)', boxSizing: 'border-box' }} />
          Zegarek przez Stravę
        </span>
        <span style={{ font: sans(14), lineHeight: 1.45, color: 'var(--text-2)' }}>
          Garmin, Polar, Suunto, Coros… Jeśli zegarek wysyła treningi do Stravy, trafią tu same, razem z kaloriami — bez dodatkowej aplikacji na telefonie.
        </span>
        <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>{STRAVA_CHAIN}</span>
        <Button variant="outline" size="sm" style={{ alignSelf: 'flex-start' }} disabled={!status.configured || connect.isPending} onClick={() => connect.mutate(undefined, { onError: fail })}>
          {connect.isPending ? 'Otwieram Stravę…' : 'Połącz ze Stravą'}
        </Button>
        {!status.configured && (
          <span style={{ font: sans(13), lineHeight: 1.5, color: 'var(--text-3)' }}>
            {isAdmin ? (
              <>
                Strava nie jest jeszcze ustawiona na serwerze: dodaj <code style={{ font: mono(12) }}>STRAVA_CLIENT_ID</code> i{' '}
                <code style={{ font: mono(12) }}>STRAVA_CLIENT_SECRET</code> do <code style={{ font: mono(12) }}>.env</code> i przebuduj api.
              </>
            ) : 'Strava nie jest jeszcze skonfigurowana na serwerze — poproś administratora.'}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: sans(16, 600) }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
          Strava połączona{status.athleteName ? ` · ${status.athleteName}` : ''}
        </span>
        <span style={{ font: mono(12), color: 'var(--text-2)' }}>
          {status.lastActivityAt ? `ostatni trening ${syncLabel(status.lastActivityAt)}` : 'czeka na pierwszy trening'}
        </span>
      </div>
      <span style={{ font: mono(11.5), color: 'var(--text-3)' }}>{STRAVA_CHAIN}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="outline"
          size="sm"
          disabled={sync.isPending}
          onClick={() => sync.mutate(undefined, {
            onSuccess: (r) => showToast(!r.connected ? 'Strava odłączyła Pichci — połącz ponownie' : r.imported ? `Pobrano: ${workoutsCount(r.imported)}` : 'Brak treningów z ostatniego tygodnia'),
            onError: fail,
          })}
        >
          {sync.isPending ? 'Pobieram…' : 'Pobierz teraz'}
        </Button>
        <Button
          variant="text"
          size="sm"
          style={{ color: 'var(--text-2)' }}
          disabled={disconnect.isPending}
          onClick={() => { if (confirm('Odłączyć Stravę? Pobrane treningi zostaną.')) disconnect.mutate(undefined, { onError: fail }) }}
        >
          Odłącz
        </Button>
      </div>
    </div>
  )
}

function Setup() {
  const { data: conn } = useHealthConnection(true)
  const rotate = useRotateHealthConnection()
  const url = conn ? `${window.location.origin}/api/hc/${conn.token}` : ''
  const short = conn ? `${window.location.host}/api/hc/${conn.token.slice(0, 6)}…${conn.token.slice(-4)}` : '…'

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      showToast('Skopiowano adres')
    } catch {
      window.prompt('Skopiuj adres:', url)
    }
  }

  const steps: [string, ReactNode][] = [
    ['W Mi Fitness włącz Health Connect', 'Profil → Dodaj konta → Health Connect. Zaznacz kalorie aktywne, treningi i wagę (waga Xiaomi Smart Scale 2 też idzie przez Mi Fitness).'],
    ['Zainstaluj HC Webhook', 'Darmowa aplikacja (GitHub / Google Play). Daj jej dostęp do kalorii aktywnych, kalorii całkowitych, treningów i wagi.'],
    ['Wklej adres w HC Webhook', 'Dodaj go jako webhook i ustaw wysyłanie co 15–30 minut. Pierwsza synchronizacja ściąga ostatnie 2 dni.'],
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {steps.map(([title, text], i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 8, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ font: mono(13, 600) }}>{String(i + 1).padStart(2, '0')}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ font: sans(15, 500) }}>{title}</span>
            <span style={{ font: sans(13.5), lineHeight: 1.45, color: 'var(--text-2)' }}>{text}</span>
          </span>
        </div>
      ))}
      <Eyebrow style={{ paddingTop: 10 }}>Adres dla tego telefonu</Eyebrow>
      <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
        <span style={{ flex: 1, minWidth: 0, height: 46, display: 'flex', alignItems: 'center', padding: '0 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)', font: mono(13), overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {short}
        </span>
        <Button variant="dark" disabled={!conn} onClick={copy}>Kopiuj</Button>
      </div>
      <span style={{ font: sans(13), lineHeight: 1.5, color: 'var(--text-3)', paddingTop: 10 }}>
        Każda osoba ma własny adres — wklej go w HC Webhook na swoim telefonie. Działa jak hasło, nie udostępniaj go.{' '}
        <button
          type="button"
          onClick={() => { if (confirm('Wygenerować nowy adres? Stary przestanie działać — trzeba będzie wkleić nowy w HC Webhook.')) rotate.mutate() }}
          style={{ border: 0, background: 'transparent', padding: 0, font: sans(13, 600), color: 'var(--text-2)', textDecoration: 'underline', cursor: 'pointer' }}
        >
          Nowy adres
        </button>
      </span>
    </div>
  )
}
