import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from './client'
import { useAuth, usePerson } from './hooks'

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

// ---- Training: questionnaire, programs, today (private, per person) ----

export type TrainingGoal = 'lose-fat' | 'tone' | 'strength' | 'mobility' | 'general'
export type TrainingLocation = 'home' | 'gym' | 'any'
export type TrainingStyle = 'strength' | 'pilates' | 'yoga' | 'hiit' | 'stretching' | 'cardio'
export type DayKind = 'exercises' | 'follow-along'
export type SwapDirection = 'easier' | 'similar' | 'harder'
export type SwapLocation = 'home' | 'gym' | 'none'

export interface TrainingProfile {
  configured: boolean
  goal: TrainingGoal
  level: ExerciseLevel
  daysPerWeek: number
  minutesPerSession: number
  /** Bit 0 = Monday … bit 6 = Sunday; 0 = any. */
  preferredWeekdays: number
  location: TrainingLocation
  homeEquipment: Equipment[]
  styles: TrainingStyle[]
  limitations: string
  dislikes: string
  notes: string
  updatedAt: string | null
}

export type TrainingProfileInput = Omit<TrainingProfile, 'configured' | 'updatedAt'>

export interface ProgramExercise {
  id: string
  order: number
  exerciseId: string
  name: string
  nameEn: string
  equipment: Equipment
  primaryMuscles: Muscle[]
  isTimed: boolean
  hasVideo: boolean
  thumbnailUrl: string | null
  sets: number
  repsMin: number | null
  repsMax: number | null
  seconds: number | null
  restSeconds: number
  targetKg: number | null
  notes: string
  supersetGroup: string | null
}

export interface ProgramDay {
  id: string
  week: number
  /** 0 = Monday … 6 = Sunday. */
  weekday: number
  date: string
  name: string
  kind: DayKind
  location: TrainingLocation
  notes: string
  video: { youtubeId: string; title: string | null; minutes: number | null; workoutType: string | null } | null
  exercises: ProgramExercise[]
}

export interface TrainingProgram {
  id: string
  name: string
  description: string
  rationale: string
  startDate: string
  endDate: string
  weeks: number
  status: 'active' | 'draft' | 'archived'
  createdBy: 'ai' | 'manual'
  createdAt: string
  updatedAt: string
  days: ProgramDay[]
}

export interface TrainingProgramSummary {
  id: string
  name: string
  startDate: string
  endDate: string
  weeks: number
  status: TrainingProgram['status']
  createdBy: string
  dayCount: number
  updatedAt: string
}

export interface TrainingToday {
  date: string
  status: 'none' | 'before-start' | 'scheduled' | 'rest' | 'finished'
  program: TrainingProgramSummary | null
  week: number | null
  day: ProgramDay | null
  next: ProgramDay | null
}

export interface ProgramExerciseInput {
  exerciseId: string
  sets?: number
  repsMin?: number | null
  repsMax?: number | null
  seconds?: number | null
  restSeconds?: number
  targetKg?: number | null
  notes?: string
  supersetGroup?: string | null
}

export interface ProgramDayInput {
  week: number
  weekday: number
  name: string
  kind: DayKind
  location?: TrainingLocation
  notes?: string
  videoYoutubeId?: string | null
  videoMinutes?: number | null
  workoutType?: string | null
  exercises?: ProgramExerciseInput[]
}

export interface TrainingProgramInput {
  name: string
  description?: string
  rationale?: string
  startDate?: string
  weeks?: number
  activate?: boolean
  createdBy?: 'ai' | 'manual'
  days: ProgramDayInput[]
}

export interface ProgramExercisePatch {
  exerciseId?: string
  sets?: number
  repsMin?: number | null
  repsMax?: number | null
  seconds?: number | null
  restSeconds?: number
  targetKg?: number | null
  clearTargetKg?: boolean
  notes?: string
  applyToFollowingWeeks?: boolean
}

export interface ExerciseAlternatives {
  exerciseId: string
  direction: SwapDirection
  location: string
  items: ExerciseListItem[]
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const trainingApi = {
  exercises: (f: ExerciseQuery) => http<ExerciseList>(`/exercises?${exerciseQs(f)}`),
  exercise: (id: string) => http<ExerciseDetail>(`/exercises/${id}`),
  alternatives: (id: string, direction: SwapDirection, location: SwapLocation) =>
    http<ExerciseAlternatives>(`/exercises/${id}/alternatives?direction=${direction}&location=${location}&limit=12`),
  profile: () => http<TrainingProfile>('/training/profile'),
  saveProfile: (input: TrainingProfileInput) => http<TrainingProfile>('/training/profile', json('PUT', input)),
  /** undefined when there is no active program (204). */
  program: () => http<TrainingProgram | undefined>('/training/program'),
  today: (date?: string) => http<TrainingToday>(`/training/today${date ? `?date=${date}` : ''}`),
  createProgram: (input: TrainingProgramInput) => http<TrainingProgram>('/training/programs', json('POST', input)),
  patchProgram: (id: string, input: { name?: string; startDate?: string; status?: TrainingProgram['status'] }) =>
    http<TrainingProgram>(`/training/programs/${id}`, json('PATCH', input)),
  addDay: (programId: string, day: ProgramDayInput) =>
    http<TrainingProgram>(`/training/programs/${programId}/days`, json('POST', day)),
  saveDay: (programId: string, dayId: string, day: ProgramDayInput) =>
    http<TrainingProgram>(`/training/programs/${programId}/days/${dayId}`, json('PUT', day)),
  deleteDay: (programId: string, dayId: string) =>
    http<void>(`/training/programs/${programId}/days/${dayId}`, { method: 'DELETE' }),
  patchExercise: (id: string, input: ProgramExercisePatch) =>
    http<{ swapped: number; program: TrainingProgram }>(`/training/program-exercises/${id}`, json('PATCH', input)),
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

export function useExerciseAlternatives(id: string | null, direction: SwapDirection, location: SwapLocation) {
  return useQuery({
    queryKey: ['exerciseAlternatives', id, direction, location],
    queryFn: () => trainingApi.alternatives(id!, direction, location),
    enabled: !!id,
    staleTime: 60_000,
  })
}

// Private training data: keys carry the person, so a switch never shows the other diary's cache.

export function useTrainingProfile() {
  const { canEdit } = useAuth()
  const { id } = usePerson()
  return useQuery({ queryKey: ['training', id, 'profile'], queryFn: trainingApi.profile, enabled: canEdit })
}

export function useTrainingProgram() {
  const { canEdit } = useAuth()
  const { id } = usePerson()
  return useQuery({
    queryKey: ['training', id, 'program'],
    queryFn: async () => (await trainingApi.program()) ?? null,
    enabled: canEdit,
  })
}

export function useTrainingToday(date?: string) {
  const { canEdit } = useAuth()
  const { id } = usePerson()
  return useQuery({ queryKey: ['training', id, 'today', date ?? null], queryFn: () => trainingApi.today(date), enabled: canEdit })
}

/** Every training write refreshes all of the person's training queries. */
function useTrainingMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['training'] }) })
}

export const useSaveTrainingProfile = () => useTrainingMutation(trainingApi.saveProfile)
export const useCreateProgram = () => useTrainingMutation(trainingApi.createProgram)
export const usePatchProgram = () =>
  useTrainingMutation((a: { id: string; input: Parameters<typeof trainingApi.patchProgram>[1] }) => trainingApi.patchProgram(a.id, a.input))
export const useSaveDay = () =>
  useTrainingMutation((a: { programId: string; dayId?: string; day: ProgramDayInput }) =>
    a.dayId ? trainingApi.saveDay(a.programId, a.dayId, a.day) : trainingApi.addDay(a.programId, a.day))
export const useDeleteDay = () =>
  useTrainingMutation((a: { programId: string; dayId: string }) => trainingApi.deleteDay(a.programId, a.dayId))
export const usePatchProgramExercise = () =>
  useTrainingMutation((a: { id: string; input: ProgramExercisePatch }) => trainingApi.patchExercise(a.id, a.input))

// ---- display helpers ----

/** "3 × 10–12", "3 × 30 s" — sets and reps/time of one slot. */
export function setsLabel(e: Pick<ProgramExercise, 'sets' | 'repsMin' | 'repsMax' | 'seconds'>): string {
  if (e.seconds != null) return `${e.sets} × ${e.seconds} s`
  const reps = e.repsMax == null || e.repsMin === e.repsMax ? `${e.repsMin ?? '?'}` : `${e.repsMin ?? '?'}–${e.repsMax}`
  return `${e.sets} × ${reps}`
}

/** "3 × 10–12 · 8 kg · przerwa 75 s". */
export function targetLine(e: ProgramExercise): string {
  return [setsLabel(e), e.targetKg != null ? `${String(e.targetKg).replace('.', ',')} kg` : null, `przerwa ${e.restSeconds} s`]
    .filter(Boolean)
    .join(' · ')
}

