import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  type CookLogInput,
  type CookLogUpdateInput,
  type PantryItemInput,
  type PantryConfirmation,
  type PlanEntryInput,
  type Preferences,
  type RecipeInput,
  type SupplyCategory,
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
    },
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
