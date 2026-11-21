import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../api/hooks'
import { CatalogView } from './training/CatalogView'
import { HistoryView } from './training/HistoryView'
import { ProgramView } from './training/ProgramView'
import { TodayView } from './training/TodayView'
import { TrainingQuestionnaire } from './training/TrainingQuestionnaire'

/**
 * Trening shell: Dziś (today's workout + live launch), Plan (the program week by week),
 * Historia (completed sessions + PRs), Ćwiczenia (the public catalog) and the questionnaire.
 * Anonymous visitors land on the catalog.
 */
export function Training() {
  const { pathname } = useLocation()
  const { canEdit, isLoading } = useAuth()
  if (pathname.startsWith('/trening/cwiczenia')) return <CatalogView />
  if (pathname.startsWith('/trening/dzis')) return <TodayView />
  if (pathname.startsWith('/trening/plan')) return <ProgramView />
  if (pathname.startsWith('/trening/historia')) return <HistoryView />
  if (pathname.startsWith('/trening/ankieta')) return <TrainingQuestionnaire />
  if (isLoading) return null
  return <Navigate to={canEdit ? '/trening/dzis' : '/trening/cwiczenia'} replace />
}
