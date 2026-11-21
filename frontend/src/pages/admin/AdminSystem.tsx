import { errorText } from '../../api/client'
import { useAdminActions, useAdminSystem } from '../../api/hooks'
import { Button, Eyebrow, SectionHead, StatStrip, mono, sans } from '../../components/ui'
import { syncLabel } from '../../lib/dates'
import { showToast } from '../../lib/toastBus'

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString('pl-PL', { maximumFractionDigits: v >= 10 ? 1 : 2 })} ${units[i]}`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${mins} min`
  return `${mins} min`
}

function StatusPill({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  const dot = ok ? 'var(--sage)' : warn ? 'var(--gold)' : 'var(--accent)'
  const text = ok ? 'var(--sage-text)' : warn ? 'var(--gold-text)' : 'var(--accent-text)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: mono(12, 500), color: text }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
      {label}
    </span>
  )
}

function DiagRow({ label, status, meta, action }: {
  label: string
  status: React.ReactNode
  meta?: string | null
  action?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '13px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ font: sans(15, 500) }}>{label}</span>
        {meta && <span style={{ font: sans(13), color: 'var(--text-2)' }}>{meta}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {status}
        {action}
      </div>
    </div>
  )
}

/** Operational diagnostics for the instance admin: services, DB migrations, storage, enrichment. */
export function AdminSystem() {
  const { data, isLoading, isFetching, refetch } = useAdminSystem()
  const { wakeEnrichment } = useAdminActions()

  async function onWake() {
    try {
      await wakeEnrichment.mutateAsync()
      showToast('Wznowiono wzbogacanie ćwiczeń w tle.')
    } catch (err) {
      showToast(errorText(err, 'Nie udało się wznowić zadania.'))
    }
  }

  if (isLoading || !data) {
    return <span style={{ font: sans(14.5), color: 'var(--text-3)' }}>Sprawdzam stan usług…</span>
  }

  const sousLabel = !data.sous.configured
    ? 'Wyłączony'
    : !data.sous.reachable
      ? 'Nieosiągalny'
      : data.sous.loggedIn
        ? `OK (${data.sous.provider})`
        : 'Brak logowania'

  const enrichPct = data.enrichment.totalCount > 0
    ? Math.round((data.enrichment.enrichedCount / data.enrichment.totalCount) * 100)
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ font: mono(12), color: 'var(--text-2)' }}>
          .NET {data.dotnetVersion} · {data.environment} · czas działania: {formatUptime(data.uptimeSeconds)}
          {data.publicHouseholdEnabled ? ' · publiczny podgląd: WŁ.' : ' · tryb prywatny'}
        </span>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
          {isFetching ? 'Odświeżam…' : 'Odśwież status'}
        </Button>
      </div>

      <StatStrip items={[
        { value: data.counts.recipes, label: 'przepisy' },
        { value: data.counts.pantryItems, label: 'spiżarnia' },
        { value: data.counts.planEntries, label: 'wpisy planu' },
        { value: data.counts.chatMessages, label: 'wiadomości Sous' },
        { value: data.counts.recipeShares, label: 'aktywne linki' },
        { value: `${data.counts.exercisesEnriched}/${data.counts.exercises}`, label: 'opisane ćwiczenia' },
      ]} />

      <section style={{ display: 'flex', flexDirection: 'column' }}>
        <SectionHead title="Usługi i zadania w tle" size={22} />

        <DiagRow
          label="Baza danych PostgreSQL"
          meta={
            data.pendingMigrations.length > 0
              ? `Oczekujące migracje: ${data.pendingMigrations.join(', ')}`
              : `Zastosowane migracje: ${data.appliedMigrationsCount}`
          }
          status={
            <StatusPill
              ok={data.dbConnected && data.pendingMigrations.length === 0}
              warn={data.dbConnected && data.pendingMigrations.length > 0}
              label={!data.dbConnected ? 'Brak połączenia' : data.pendingMigrations.length > 0 ? 'Wymaga migracji' : 'Połączona'}
            />
          }
        />

        <DiagRow
          label="Asystent Sous"
          meta={data.sous.error ?? (data.sous.configured ? `Dostawca: ${data.sous.provider}` : 'AI_PROVIDER nie jest ustawiony.')}
          status={
            <StatusPill
              ok={data.sous.configured && data.sous.reachable && data.sous.loggedIn}
              warn={!data.sous.configured}
              label={sousLabel}
            />
          }
        />

        <DiagRow
          label="Wzbogacanie ćwiczeń (opisy PL + YouTube)"
          meta={[
            `${data.enrichment.enrichedCount} z ${data.enrichment.totalCount} (${enrichPct}%)`,
            data.enrichment.lastRunAt ? `ostatnio: ${syncLabel(data.enrichment.lastRunAt)}` : null,
            data.enrichment.lastError ? `błąd: ${data.enrichment.lastError}` : null,
          ].filter(Boolean).join(' · ')}
          status={
            <StatusPill
              ok={data.enrichment.enabled && !data.enrichment.lastError}
              warn={!data.enrichment.enabled || Boolean(data.enrichment.pausedUntil)}
              label={
                !data.enrichment.enabled
                  ? 'Wyłączone'
                  : data.enrichment.running
                    ? 'Pracuje…'
                    : data.enrichment.pausedUntil
                      ? 'Wstrzymane'
                      : 'Gotowe'
              }
            />
          }
          action={
            data.enrichment.enabled && (
              <Button variant="quiet" size="sm" disabled={wakeEnrichment.isPending} onClick={onWake}>
                Wznów teraz
              </Button>
            )
          }
        />

        <DiagRow
          label="Integracja Strava"
          meta={
            data.strava.configured
              ? [
                  `Połączonych kont: ${data.strava.connectionsCount}`,
                  data.strava.webhookRegistered ? `webhook #${data.strava.subscriptionId}` : 'polling co 3 h',
                  data.strava.lastActivityAt ? `ostatni trening: ${syncLabel(data.strava.lastActivityAt)}` : null,
                ].filter(Boolean).join(' · ')
              : 'STRAVA_CLIENT_ID / SECRET nie są ustawione.'
          }
          status={
            <StatusPill
              ok={data.strava.configured}
              warn={!data.strava.configured}
              label={data.strava.configured ? 'Aktywna' : 'Wyłączona'}
            />
          }
        />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column' }}>
        <SectionHead title="Pamięć, pliki i eksport" size={22} />

        <DiagRow
          label="Zdjęcia przepisów (oryginały)"
          meta={`Plików: ${data.storage.imageFiles}`}
          status={<span style={{ font: mono(13, 500) }}>{formatBytes(data.storage.imageBytes)}</span>}
        />

        <DiagRow
          label="Miniatury kart (card-v1 WebP)"
          meta={`Plików: ${data.storage.thumbnailFiles}`}
          status={<span style={{ font: mono(13, 500) }}>{formatBytes(data.storage.thumbnailBytes)}</span>}
        />

        <DiagRow
          label="Wolumen dyskowy"
          meta={data.storage.diskTotalBytes != null ? `Pojemność: ${formatBytes(data.storage.diskTotalBytes)}` : 'Informacja o dysku niedostępna.'}
          status={
            <span style={{ font: mono(13, 500), color: data.storage.diskFreeBytes != null && data.storage.diskFreeBytes < 2e9 ? 'var(--accent-text)' : 'var(--text)' }}>
              wolne: {formatBytes(data.storage.diskFreeBytes)}
            </span>
          }
        />

        <DiagRow
          label="Kolejka eksportu ./context"
          meta={data.storage.lastContextExportAt ? `Ostatni zapis: ${syncLabel(data.storage.lastContextExportAt)}` : 'Brak zapisów od startu kontenera.'}
          status={<Eyebrow tone="muted">w kolejce: {data.storage.pendingContextExports}</Eyebrow>}
        />
      </section>
    </div>
  )
}
