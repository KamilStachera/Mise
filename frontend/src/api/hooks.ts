import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  type BodyInput,
  type CookAssignment,
  type CookInput,
  type CookLogInput,
  type CookLogUpdateInput,
  type DiaryEntryInput,
  type PantryItemInput,
  type PantryConfirmation,
  type PlanEntryInput,
  type PlanEntryPatch,
  type Preferences,
  type RecipeInput,
  type Slot,
  type SupplyCategory,
  type WorkoutInput,
} from './client'

// Session state; the react-query cache is the shared auth state (no context needed).
// staleTime: Infinity — refreshed only by explicit invalidation (logout, 401 backstop).
export function useAuth() {
  const query = useQuery({ queryKey: ['auth'], queryFn: api.authMe, staleTime: Infinity })
  return { ...query, canEdit: query.data?.authenticated === true }
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth'] }),
  })
}

export function useRecipes(source: string, q: string) {
  return useQuery({ queryKey: ['recipes', source, q], queryFn: () => api.recipes(source, q) })
}

export function useRecipe(id: string | undefined) {
  return useQuery({ queryKey: ['recipe', id], queryFn: () => api.recipe(id!), enabled: !!id })
}

export function usePantry() {
  return useQuery({ queryKey: ['pantry'], queryFn: api.pantry })
}

export function useShopping() {
  return useQuery({ queryKey: ['shopping'], queryFn: api.shopping })
}

export function useSupplies() {
  return useQuery({ queryKey: ['supplies'], queryFn: api.supplies })
}

/** Only fetched while the "Zarządzaj częstymi" panel is open. */
export function useAllHotSupplies(enabled: boolean) {
  return useQuery({ queryKey: ['supplies', 'hot', 'all'], queryFn: api.allHotSupplies, enabled })
}

export function usePreferences() {
  return useQuery({ queryKey: ['preferences'], queryFn: api.preferences })
}

export function useCookbook() {
  return useQuery({ queryKey: ['cookbook'], queryFn: api.cookbook })
}

export function useQuestionnaire() {
  return useQuery({ queryKey: ['questionnaire'], queryFn: api.questionnaire })
}

export function useCookLog(recipeId?: string, limit?: number) {
  return useQuery({
    queryKey: ['cooklog', recipeId ?? 'all', limit ?? 'default'],
    queryFn: () => api.cookLog(recipeId, limit),
  })
}

export function usePlan(start?: string) {
  return useQuery({ queryKey: ['plan', start ?? 'current'], queryFn: () => api.plan(start) })
}

/** Past plan entries never logged as cooked — drives the login reminder modal. */
export function usePendingCook(enabled: boolean) {
  return useQuery({ queryKey: ['pendingCook'], queryFn: api.pendingCook, enabled })
}

export function useDismissCookReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.dismissCookReminder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pendingCook'] }),
  })
}

export function useConnectInfo() {
  return useQuery({ queryKey: ['connect'], queryFn: api.connectInfo })
}

// Chat endpoints are privileged — don't fire them anonymously (they would 401).
export function useChatHealth() {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['chatHealth'], queryFn: api.chatHealth, enabled: canEdit })
}

export function useChatHistory() {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['chatHistory'], queryFn: api.chatHistory, enabled: canEdit })
}

export function useCookProposal(recipeId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['cookProposal', recipeId],
    queryFn: () => api.cookProposal(recipeId!),
    enabled: !!recipeId && enabled,
  })
}

// ---- mutations ----
// The shopping list is independent of the pantry, so pantry mutations do not
// invalidate it; recipe queries embed have/missing, cookbook.md a pantry snapshot.
function usePantryMutation<TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pantry'] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
      qc.invalidateQueries({ queryKey: ['cookProposal'] })
    },
  })
}

export function useSetPantryQuantity() {
  return usePantryMutation(({ id, quantity }: { id: string; quantity: number }) =>
    api.setPantryQuantity(id, quantity))
}

export function useUpdatePantry() {
  return usePantryMutation(({ id, input }: { id: string; input: PantryItemInput }) =>
    api.updatePantry(id, input))
}

export function useAddPantry() {
  return usePantryMutation((input: PantryItemInput) => api.addPantry(input))
}

export function useDeletePantry() {
  return usePantryMutation((id: string) => api.deletePantry(id))
}

export function useCheckShopping() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.checkShopping(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopping'] }),
  })
}

export function useClearChecked() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.clearChecked(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopping'] }),
  })
}

export function useClearShopping() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.clearShopping(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopping'] }),
  })
}

export function useDeleteShopping() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteShopping(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopping'] }),
  })
}

export function useAddShopping() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, category }: { name: string; category?: string }) => api.addShopping(name, category),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopping'] }),
  })
}

// The supplies list touches nothing else — not the pantry, not the food shopping
// list — so these invalidate their own key and only their own key. `['supplies']`
// carries the hot ranking too, which every one of these can move.
function useSupplyMutation<TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  })
}

export function useAddSupply() {
  return useSupplyMutation(({ name, category }: { name: string; category?: SupplyCategory }) =>
    api.addSupply(name, category))
}

export function useCheckSupply() {
  return useSupplyMutation((id: string) => api.checkSupply(id))
}

export function useDeleteSupply() {
  return useSupplyMutation((id: string) => api.deleteSupply(id))
}

export function useClearCheckedSupplies() {
  return useSupplyMutation<void>(() => api.clearCheckedSupplies())
}

export function useClearSupplies() {
  return useSupplyMutation<void>(() => api.clearSupplies())
}

export function useUpdateHotSupply() {
  return useSupplyMutation(({ id, ...patch }: { id: string; pinned?: boolean; hidden?: boolean }) =>
    api.updateHotSupply(id, patch))
}

export function useForgetHotSupply() {
  return useSupplyMutation((id: string) => api.forgetHotSupply(id))
}

export function useAddMissingToShopping() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.addMissingToShopping(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopping'] }),
  })
}

export function useSetRecipeServings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, servings }: { id: string; servings: number }) => api.setRecipeServings(id, servings),
    onSuccess: () => {
      // Scaling changes ingredient amounts, missing/to-buy and deduction proposals.
      qc.invalidateQueries({ queryKey: ['recipe'] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['cookProposal'] })
    },
  })
}

export function useCreateRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RecipeInput) => api.createRecipe(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
    },
  })
}

export function useDeleteRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteRecipe(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
    },
  })
}

export function useUploadRecipeImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.uploadRecipeImage(id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe'] })
    },
  })
}

export function useDeleteRecipeImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, imageId }: { id: string; imageId: string }) => api.deleteRecipeImage(id, imageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe'] })
    },
  })
}

export function useSetDefaultRecipeImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, imageId }: { id: string; imageId: string }) => api.setDefaultRecipeImage(id, imageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe'] })
    },
  })
}

export function useSavePreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: Preferences) => api.savePreferences(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['preferences'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
    },
  })
}

export function useSaveAnswers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (answers: Record<string, string>) => api.saveAnswers(answers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questionnaire'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
    },
  })
}

export function useAddCookLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CookLogInput) => api.addCookLog(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cooklog'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
      qc.invalidateQueries({ queryKey: ['pendingCook'] })
      // the plan grid shows a "cooked" checkmark derived from the cook log
      qc.invalidateQueries({ queryKey: ['plan'] })
      // deductions change pantry stock and every have/missing computation
      qc.invalidateQueries({ queryKey: ['pantry'] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe'] })
      qc.invalidateQueries({ queryKey: ['cookProposal'] })
    },
  })
}

export function useUpdateCookLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CookLogUpdateInput }) => api.updateCookLog(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cooklog'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
      qc.invalidateQueries({ queryKey: ['pendingCook'] })
      qc.invalidateQueries({ queryKey: ['plan'] })
    },
  })
}

export function useDeleteCookLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteCookLog(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cooklog'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
      qc.invalidateQueries({ queryKey: ['pendingCook'] })
      qc.invalidateQueries({ queryKey: ['plan'] })
    },
  })
}

export function useSetPlanEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PlanEntryInput) => api.setPlanEntry(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
      qc.invalidateQueries({ queryKey: ['pendingCook'] })
    },
  })
}

export function useDeletePlanEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deletePlanEntry(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
      qc.invalidateQueries({ queryKey: ['pendingCook'] })
      // deleting a cook day drops its whole pot
      qc.invalidateQueries({ queryKey: ['fridge'] })
      qc.invalidateQueries({ queryKey: ['cook'] })
    },
  })
}

// ---- diary (private: never fetched anonymously — /diary would 401) ----

export function useFridge(today: string) {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['fridge', today], queryFn: () => api.fridge(today), enabled: canEdit })
}

export function useCook(id: string | null) {
  return useQuery({ queryKey: ['cook', id], queryFn: () => api.cook(id!), enabled: !!id })
}

export function useFoodFavorites(enabled: boolean) {
  return useQuery({ queryKey: ['foodFavorites'], queryFn: api.foodFavorites, enabled })
}

// ---- body / budget / progress (private like the diary) ----

export function useBody() {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['body'], queryFn: api.body, enabled: canEdit })
}

export function useBudget(start: string, days = 7) {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['budget', start, days], queryFn: () => api.budget(start, days), enabled: canEdit })
}

export function useProgress(days: number) {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['progress', days], queryFn: () => api.progress(days), enabled: canEdit })
}

export function useActivity(days = 7) {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['activity', days], queryFn: () => api.activity(days), enabled: canEdit })
}

export function useHealthConnection(enabled: boolean) {
  return useQuery({ queryKey: ['healthConnection'], queryFn: api.healthConnection, enabled })
}

export function useRotateHealthConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.rotateHealthConnection,
    onSuccess: (data) => {
      qc.setQueryData(['healthConnection'], data)
      qc.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}

/** Workouts move the day's budget, so budget and progress refresh too. */
function useActivityInvalidation() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['activity'] })
    qc.invalidateQueries({ queryKey: ['budget'] })
    qc.invalidateQueries({ queryKey: ['progress'] })
  }
}

export function useAddWorkout() {
  const onSuccess = useActivityInvalidation()
  return useMutation({ mutationFn: (input: WorkoutInput) => api.addWorkout(input), onSuccess })
}

export function useDeleteWorkout() {
  const onSuccess = useActivityInvalidation()
  return useMutation({ mutationFn: (id: string) => api.deleteWorkout(id), onSuccess })
}

function useBodyInvalidation() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['body'] })
    qc.invalidateQueries({ queryKey: ['budget'] })
    qc.invalidateQueries({ queryKey: ['progress'] })
  }
}

export function useSaveBody() {
  const onSuccess = useBodyInvalidation()
  return useMutation({ mutationFn: (input: BodyInput) => api.saveBody(input), onSuccess })
}

export function useSetWeight() {
  const onSuccess = useBodyInvalidation()
  return useMutation({ mutationFn: ({ date, kg }: { date: string; kg: number }) => api.setWeight(date, kg), onSuccess })
}

export function useDeleteWeight() {
  const onSuccess = useBodyInvalidation()
  return useMutation({ mutationFn: (date: string) => api.deleteWeight(date), onSuccess })
}

/** Everything a diary write can touch: the calendar, pots, chips, the cook reminder, progress. */
function useDiaryInvalidation() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['progress'] })
    qc.invalidateQueries({ queryKey: ['plan'] })
    qc.invalidateQueries({ queryKey: ['fridge'] })
    qc.invalidateQueries({ queryKey: ['cook'] })
    qc.invalidateQueries({ queryKey: ['foodFavorites'] })
    qc.invalidateQueries({ queryKey: ['pendingCook'] })
    qc.invalidateQueries({ queryKey: ['cookbook'] })
  }
}

export function useAddDiaryEntry() {
  const onSuccess = useDiaryInvalidation()
  return useMutation({ mutationFn: (input: DiaryEntryInput) => api.addDiaryEntry(input), onSuccess })
}

export function usePatchPlanEntry() {
  const onSuccess = useDiaryInvalidation()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PlanEntryPatch }) => api.patchPlanEntry(id, patch),
    onSuccess,
  })
}

export function useCreateCook() {
  const onSuccess = useDiaryInvalidation()
  return useMutation({ mutationFn: (input: CookInput) => api.createCook(input), onSuccess })
}

export function useUpdateCook() {
  const onSuccess = useDiaryInvalidation()
  return useMutation({
    mutationFn: ({ id, portions, assignments }: { id: string; portions: number; assignments: CookAssignment[] }) =>
      api.updateCook(id, portions, assignments),
    onSuccess,
  })
}

export function useEatFromCook() {
  const onSuccess = useDiaryInvalidation()
  return useMutation({
    mutationFn: ({ id, date, slot }: { id: string; date: string; slot: Slot }) => api.eatFromCook(id, date, slot),
    onSuccess,
  })
}

export function useDiscardCook() {
  const onSuccess = useDiaryInvalidation()
  return useMutation({ mutationFn: (id: string) => api.discardCook(id), onSuccess })
}

export function useLogFavorite() {
  const onSuccess = useDiaryInvalidation()
  return useMutation({
    mutationFn: ({ id, date, slot, grams }: { id: string; date: string; slot: Slot; grams?: number }) =>
      api.logFavorite(id, date, slot, grams),
    onSuccess,
  })
}

export function usePlanAddMissing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ start, days, confirmations }: { start: string; days: number; confirmations?: PantryConfirmation[] }) =>
      api.planAddMissing(start, days, confirmations),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shopping'] })
      qc.invalidateQueries({ queryKey: ['pantry'] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
    },
  })
}

export function usePlanShoppingPreview() {
  return useMutation({
    mutationFn: ({ start, days }: { start: string; days: number }) =>
      api.planShoppingPreview(start, days),
  })
}

export function useExportContext() {
  return useMutation({ mutationFn: () => api.exportContext() })
}
