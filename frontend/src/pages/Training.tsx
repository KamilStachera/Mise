import { Navigate, useLocation } from 'react-router-dom'
import { CatalogView } from './training/CatalogView'

/**
 * Trening shell. Ćwiczenia (the exercise catalog) is public like recipes; the private views
 * (Dziś, Plan, Historia) arrive with the training plan.
 */
export function Training() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/trening/cwiczenia')) return <CatalogView />
  return <Navigate to="/trening/cwiczenia" replace />
}
