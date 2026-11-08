import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { http } from './client'

// ---- Training: exercise catalog (public to read; writes need access) ----

export type Muscle =
  | 'abdominals' | 'abductors' | 'adductors' | 'biceps' | 'calves' | 'chest' | 'forearms' | 'glutes'
  | 'hamstrings' | 'lats' | 'lower-back' | 'middle-back' | 'neck' | 'quadriceps' | 'shoulders' | 'traps' | 'triceps'
export type Equipment =
  | 'body-only' | 'dumbbell' | 'kettlebell' | 'bands' | 'barbell' | 'ez-bar' | 'cable' | 'machine'
  | 'medicine-ball' | 'exercise-ball' | 'foam-roll' | 'other'
export type ExerciseLevel = 'beginner' | 'intermediate' | 'expert'
export type ExerciseCategory =
  | 'strength' | 'stretching' | 'plyometrics' | 'cardio' | 'powerlifting' | 'olympic-weightlifting'
  | 'strongman' | 'pilates' | 'yoga' | 'mobility'

export interface ExerciseListItem {
  id: string
  /** Polish name when written, else English. */
  name: string
  nameEn: string
  namePl: string | null
  category: ExerciseCategory
  level: ExerciseLevel
  equipment: Equipment
  primaryMuscles: Muscle[]
  secondaryMuscles: Muscle[]
  isTimed: boolean
  hasVideo: boolean
  /** Polish description written (by an agent). */
  enriched: boolean
  thumbnailUrl: string | null
}

export interface ExerciseList {
  total: number
  enrichedTotal: number
  catalogTotal: number
  items: ExerciseListItem[]
}

export interface ExerciseDetail {
  id: string
  sourceId: string | null
  name: string
  nameEn: string
  namePl: string | null
  category: ExerciseCategory
  level: ExerciseLevel
  force: 'push' | 'pull' | 'static' | null
  mechanic: 'compound' | 'isolation' | null
  equipment: Equipment
  primaryMuscles: Muscle[]
  secondaryMuscles: Muscle[]
  /** Polish steps when written, else English (see instructionsArePolish). */
  instructions: string[]
  instructionsArePolish: boolean
  instructionsEn: string[]
  instructionsPl: string[]
  tipsPl: string[]
  mistakesPl: string[]
  youtubeId: string | null
  videoStartSeconds: number | null
  videoTitle: string | null
  videoChannel: string | null
  imageUrls: string[]
  isTimed: boolean
  hidden: boolean
  enrichedAt: string | null
}

export interface ExerciseQuery {
  q?: string
  muscle?: Muscle | null
  equipment?: Equipment[]
  level?: ExerciseLevel | null
  location?: 'home' | null
  video?: boolean
}

function exerciseQs(f: ExerciseQuery): string {
  const p = new URLSearchParams()
  if (f.q?.trim()) p.set('q', f.q.trim())
  if (f.muscle) p.set('muscle', f.muscle)
  if (f.equipment?.length) p.set('equipment', f.equipment.join(','))
  if (f.level) p.set('level', f.level)
  if (f.location) p.set('location', f.location)
  if (f.video) p.set('video', 'true')
  p.set('limit', '1000')
  return p.toString()
}

export const trainingApi = {
  exercises: (f: ExerciseQuery) => http<ExerciseList>(`/exercises?${exerciseQs(f)}`),
  exercise: (id: string) => http<ExerciseDetail>(`/exercises/${id}`),
}

export function useExercises(f: ExerciseQuery) {
  return useQuery({
    queryKey: ['exercises', f],
    queryFn: () => trainingApi.exercises(f),
    // Keep the old list on screen while a filter change loads.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

export function useExercise(id: string | null | undefined) {
  return useQuery({ queryKey: ['exercise', id], queryFn: () => trainingApi.exercise(id!), enabled: !!id, staleTime: 60_000 })
}

