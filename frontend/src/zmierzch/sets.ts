import { PART_LABEL, type Part, type Question } from './types'

export interface QuizSet {
  slug: string
  /** Scope sent to /api/zmierzch/attempts and /api/zmierzch/leaderboard. */
  scope: string
  title: string
  subtitle: string
  difficultyLabel: string
  /** Standard time limit per question (seconds) so runs are comparable head-to-head. */
  seconds: number
  /** Stable list of question IDs — never reorder or swap lightly once players have scores. */
  questionIds: readonly string[]
}

export const QUIZ_SETS: readonly QuizSet[] = [
  {
    slug: 'rozgrzewka',
    scope: 'set:rozgrzewka',
    title: 'Rozgrzewka',
    subtitle: '15 przystępnych pytań na dobry początek — po 3 z każdej części sagi.',
    difficultyLabel: 'Łatwe',
    seconds: 20,
    questionIds: [
      'zm-001', 'zm-041', 'zm-046',
      'kn-001', 'kn-038', 'kn-042',
      'za-001', 'za-036', 'za-040',
      'ps-001', 'ps-050', 'ps-055',
      'sa-005', 'sa-046', 'sa-049',
    ],
  },
  {
    slug: 'egzamin-1',
    scope: 'set:egzamin-1',
    title: 'Egzamin 1 · Klasyka sagi',
    subtitle: 'Najważniejsze wydarzenia, relacje i zwroty akcji z całej historii Belli i Edwarda.',
    difficultyLabel: 'Łatwe – średnie',
    seconds: 20,
    questionIds: [
      'zm-002', 'zm-004', 'zm-007', 'zm-010', 'zm-048',
      'kn-002', 'kn-008', 'kn-011', 'kn-015', 'kn-041',
      'za-004', 'za-008', 'za-010', 'za-012', 'za-045',
      'ps-004', 'ps-007', 'ps-008', 'ps-015', 'ps-021',
      'sa-001', 'sa-011', 'sa-020', 'sa-054', 'sa-058',
    ],
  },
  {
    slug: 'egzamin-2',
    scope: 'set:egzamin-2',
    title: 'Egzamin 2 · Film, muzyka i kulisy',
    subtitle: 'Obsada, reżyserzy, kultowe piosenki ze ścieżek dźwiękowych i sekrety z planu.',
    difficultyLabel: 'Mieszane',
    seconds: 20,
    questionIds: [
      'ku-001', 'ku-002', 'ku-003', 'ku-004', 'ku-006',
      'ku-007', 'ku-008', 'ku-010', 'ku-014', 'ku-015',
      'ku-016', 'ku-017', 'ku-018', 'ku-019', 'ku-020',
      'ku-021', 'ku-056', 'ku-059', 'ku-063', 'ku-065',
      'ku-073', 'ku-075', 'ku-078', 'ku-080', 'ku-082',
    ],
  },
  {
    slug: 'egzamin-3',
    scope: 'set:egzamin-3',
    title: 'Egzamin 3 · Książki i różnice',
    subtitle: 'Co zmieniono w ekranizacjach i które detale znają tylko czytelnicy powieści.',
    difficultyLabel: 'Średnie – trudne',
    seconds: 20,
    questionIds: [
      'zm-019', 'zm-022', 'zm-023', 'zm-034', 'zm-052',
      'zm-053', 'zm-054', 'zm-055', 'zm-057', 'zm-058',
      'kn-005', 'kn-018', 'kn-019', 'kn-025', 'kn-047',
      'kn-048', 'kn-049', 'kn-053', 'za-017', 'za-034',
      'ps-031', 'ps-059', 'ps-061', 'ps-062', 'sa-063',
    ],
  },
  {
    slug: 'mistrz',
    scope: 'set:mistrz',
    title: 'Egzamin 4 · Poziom Volturi',
    subtitle: 'Trudne pytania dla prawdziwych weteranów: imiona, daty, moce i szczegóły drugiego planu.',
    difficultyLabel: 'Trudne',
    seconds: 20,
    questionIds: [
      'zm-021', 'zm-033', 'zm-035', 'zm-037', 'zm-061',
      'kn-012', 'kn-032', 'kn-036', 'kn-037', 'kn-058',
      'za-003', 'za-006', 'za-030', 'za-031', 'za-032',
      'ps-013', 'ps-033', 'ps-038', 'ps-042', 'ps-044',
      'sa-021', 'sa-032', 'sa-033', 'sa-036', 'ku-054',
    ],
  },
  {
    slug: 'proba-mova',
    scope: 'set:proba-mova',
    title: 'Próba generalna Mova',
    subtitle: 'Pełna symulacja pub quizu: 45 pytań z każdej części, kategorii i poziomu trudności.',
    difficultyLabel: 'Wszystkie poziomy',
    seconds: 20,
    questionIds: [
      'zm-003', 'zm-011', 'zm-014', 'zm-015', 'zm-027', 'zm-039', 'zm-043', 'zm-051', 'zm-059',
      'kn-003', 'kn-004', 'kn-009', 'kn-013', 'kn-022', 'kn-027', 'kn-031', 'kn-043', 'kn-050',
      'za-002', 'za-005', 'za-013', 'za-018', 'za-022', 'za-026', 'za-038', 'za-044', 'za-049',
      'ps-002', 'ps-006', 'ps-010', 'ps-012', 'ps-019', 'ps-024', 'ps-030', 'ps-040', 'ps-063',
      'sa-002', 'sa-014', 'sa-024', 'sa-030', 'sa-051',
      'ku-005', 'ku-023', 'ku-024', 'ku-045',
    ],
  },
]

export function findSetByScope(scope: string): QuizSet | undefined {
  return QUIZ_SETS.find((s) => s.scope === scope)
}

export function resolveSetQuestions(set: QuizSet, all: readonly Question[]): Question[] {
  const byId = new Map(all.map((q) => [q.id, q]))
  const out: Question[] = []
  for (const id of set.questionIds) {
    const q = byId.get(id)
    if (q) out.push(q)
  }
  return out
}

export function scopeLabel(scope: string): string {
  if (scope === 'all') return 'Cały bank pytań'
  if (scope === 'custom') return 'Własny zestaw filtrów'
  if (scope.startsWith('part:')) {
    const part = scope.slice('part:'.length) as Part
    return PART_LABEL[part] ?? scope
  }
  const found = findSetByScope(scope)
  return found ? found.title : scope
}
