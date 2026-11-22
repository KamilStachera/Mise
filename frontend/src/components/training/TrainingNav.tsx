import { useAuth } from '../../api/hooks'
import { PersonSwitch } from '../diary/PersonSwitch'

/**
 * Whose training it is. The views (Dziś · Program · Historia · Ćwiczenia) switch in the sidebar on
 * desktop and the section strip on phones, so the header only carries the person. Signed-in only.
 */
export function TrainingNav() {
  const { canEdit } = useAuth()
  if (!canEdit) return null
  return <PersonSwitch />
}
