import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProgressMap } from './progress'

export interface ZmierzchPersonalBest {
  correct: number
  total: number
  pct: number
  durationMs: number
  attempts: number
  completedAt: string
}

export interface ZmierzchMe {
  playerId: string | null
  displayName: string
  picture: string | null
  progress: ProgressMap
  personalBests: Record<string, ZmierzchPersonalBest>
}

export interface ZmierzchAttemptInput {
  scope: string
  correct: number
  total: number
  durationMs: number
  timeLimitSeconds: number
}

export interface ZmierzchAttemptResult {
  id: string
  scope: string
  correct: number
  total: number
  pct: number
  durationMs: number
  timeLimitSeconds: number
  completedAt: string
  isPersonalBest: boolean
  rank: number | null
  totalPlayers: number
}

export interface ZmierzchRunLeader {
  rank: number
  playerId: string
  name: string
  picture: string | null
  isMe: boolean
  correct: number
  total: number
  pct: number
  durationMs: number
  timeLimitSeconds: number
  attempts: number
  completedAt: string
}

export interface ZmierzchMasteryLeader {
  rank: number
  playerId: string
  name: string
  picture: string | null
  isMe: boolean
  known: number
  learning: number
  seen: number
  accuracy: number
  totalAnswers: number
  bestCorrect: number | null
  bestTotal: number | null
  bestDurationMs: number | null
}

export interface ZmierzchLeaderboard {
  scope: string
  runs: ZmierzchRunLeader[]
  mastery: ZmierzchMasteryLeader[]
  scopeCounts: Record<string, number>
  personalBests: Record<string, ZmierzchPersonalBest>
}

async function zmierzchHttp<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/zmierzch${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : null),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      /* not JSON */
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

export const zmierzchApi = {
  me: () => zmierzchHttp<ZmierzchMe>('/me'),
  syncProgress: (progress: ProgressMap, mode: 'merge' | 'replace' = 'merge') =>
    zmierzchHttp<{ progress: ProgressMap; updatedAt: string }>('/progress', {
      method: 'PUT',
      body: JSON.stringify({ progress, mode }),
    }),
  updateProfile: (displayName: string) =>
    zmierzchHttp<{ playerId: string; displayName: string; picture: string | null }>('/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  recordAttempt: (input: ZmierzchAttemptInput) =>
    zmierzchHttp<ZmierzchAttemptResult>('/attempts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  leaderboard: (scope: string) =>
    zmierzchHttp<ZmierzchLeaderboard>(`/leaderboard?scope=${encodeURIComponent(scope)}`),
}

export function useZmierzchMe(enabled: boolean) {
  return useQuery({
    queryKey: ['zmierzch', 'me'],
    queryFn: zmierzchApi.me,
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

export function useZmierzchLeaderboard(scope: string, enabled: boolean) {
  return useQuery({
    queryKey: ['zmierzch', 'leaderboard', scope],
    queryFn: () => zmierzchApi.leaderboard(scope),
    enabled,
    staleTime: 15_000,
    retry: false,
  })
}

export function useUpdateZmierzchProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (displayName: string) => zmierzchApi.updateProfile(displayName),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['zmierzch'] })
    },
  })
}

export function useRecordZmierzchAttempt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ZmierzchAttemptInput) => zmierzchApi.recordAttempt(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['zmierzch'] })
    },
  })
}

export function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min > 0 ? `${min}:${String(sec).padStart(2, '0')}` : `${sec} s`
}
