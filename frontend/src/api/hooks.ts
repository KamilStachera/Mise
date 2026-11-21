import { useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  type BodyInput,
  type CateringInput,
  type CateringPauseInput,
  type CookAssignment,
  type CookInput,
  type CookLogInput,
  type CookLogUpdateInput,
  type DiaryEntryInput,
  type InviteStatus,
  type PantryAdjustItem,
  type PantryItemInput,
  type PantryConfirmation,
  type PlanEntryInput,
  type PlanEntryPatch,
  type Preferences,
  type RecipeDetail,
  type RecipeInput,
  type RecipeListItem,
  type RecipeNutritionInput,
  type Role,
  type ShoppingItem,
  type ShoppingList,
  type Slot,
  type SupplyCategory,
  type SupplyItem,
  type SupplyList,
  type WorkoutInput,
} from './client'
import { pickPerson, usePickedPerson } from './person'
import { clearOfflineQueue, clearSwApiCache, enqueueOfflineAction, isNetworkError, readOfflineQueue } from '../lib/offlineQueue'

// Session state; the react-query cache is the shared auth state (no context needed).
// staleTime: Infinity — refreshed only by explicit invalidation (logout, 401 backstop).
export function useAuth() {
  const query = useQuery({ queryKey: ['auth'], queryFn: api.authMe, staleTime: Infinity })
  return { ...query, canEdit: query.data?.authenticated === true }
}

/**
 * Whose diary the private screens show: the switcher pick when it is one of `people`, else the
 * caller's own. `id` goes into every private query key so a switch never shows cached data of
 * the other person; the X-Person header itself is set by pickPerson.
 */
export function usePerson() {
  const { data } = useAuth()
  const picked = usePickedPerson()
  const people = data?.people ?? []
  const own = data?.personId ?? 1
  const validPick = picked != null && people.some((p) => p.id === picked)
  useEffect(() => {
    if (data && picked != null && !validPick) pickPerson(null)
  }, [data, picked, validPick])
  const id = validPick ? picked : own
  return { id, own, people, person: people.find((p) => p.id === id) ?? null, pick: pickPerson }
}

// ---- household, invites, admin, keys ----

export function useHousehold(enabled = true) {
  return useQuery({ queryKey: ['household'], queryFn: api.household, enabled })
}

/** Refetched on every mount/focus — steps tick themselves as the person uses the app. */
export function useFirstSteps() {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['firstSteps'], queryFn: api.firstSteps, enabled: canEdit, staleTime: 0 })
}

export function useDismissFirstSteps() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.dismissFirstSteps, onSuccess: (data) => qc.setQueryData(['firstSteps'], data) })
}

// Admin panel: every query key starts with 'admin', and every admin mutation refreshes all of them.
export function useAdminOverview() {
  const { data: auth } = useAuth()
  return useQuery({ queryKey: ['admin', 'overview'], queryFn: api.admin.overview, enabled: auth?.isAdmin === true })
}

export function useAdminSystem() {
  const { data: auth } = useAuth()
  return useQuery({ queryKey: ['admin', 'system'], queryFn: api.admin.system, enabled: auth?.isAdmin === true, staleTime: 0 })
}

export function useAdminHouseholds() {
  const { data: auth } = useAuth()
  return useQuery({ queryKey: ['admin', 'households'], queryFn: api.admin.households, enabled: auth?.isAdmin === true })
}

export function useAdminPeople(filter: { q?: string; householdId?: number; status?: string }) {
  const { data: auth } = useAuth()
  return useQuery({ queryKey: ['admin', 'people', filter], queryFn: () => api.admin.people(filter), enabled: auth?.isAdmin === true })
}

export function useAdminInvites(status: InviteStatus | 'all') {
  const { data: auth } = useAuth()
  return useQuery({ queryKey: ['admin', 'invites', status], queryFn: () => api.admin.invites(status), enabled: auth?.isAdmin === true })
}

export function useAdminKeys() {
  const { data: auth } = useAuth()
  return useQuery({ queryKey: ['admin', 'keys'], queryFn: api.admin.keys, enabled: auth?.isAdmin === true })
}

/** The audit log, newest first, 50 per page ("Starsze" loads the next page). */
export function useAdminAudit() {
  const { data: auth } = useAuth()
  return useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => api.admin.audit(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].at : undefined),
    enabled: auth?.isAdmin === true,
  })
}

/** Admin mutations. Errors stay with the caller (the panel shows the server's Polish message). */
export function useAdminActions() {
  const qc = useQueryClient()
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin'] }), qc.invalidateQueries({ queryKey: ['auth'] }),
    qc.invalidateQueries({ queryKey: ['household'] }), qc.invalidateQueries({ queryKey: ['chatHealth'] })])
  const opts = { onSuccess: done, meta: { ownErrors: true } }
  return {
    patchHousehold: useMutation({
      mutationFn: ({ id, ...patch }: { id: number; name?: string; sousEnabled?: boolean; blocked?: boolean }) => api.admin.patchHousehold(id, patch),
      ...opts,
    }),
    patchPerson: useMutation({
      mutationFn: ({ id, ...patch }: { id: number; name?: string; role?: Role; isAdmin?: boolean; blocked?: boolean }) => api.admin.patchPerson(id, patch),
      ...opts,
    }),
    unlinkPerson: useMutation({ mutationFn: api.admin.unlinkPerson, ...opts }),
    createInvite: useMutation({ mutationFn: api.admin.createInvite, ...opts }),
    extendInvite: useMutation({ mutationFn: (id: string) => api.admin.extendInvite(id), ...opts }),
    revokeInvite: useMutation({ mutationFn: api.admin.revokeInvite, ...opts }),
    revokeKey: useMutation({ mutationFn: api.admin.revokeKey, ...opts }),
    wakeEnrichment: useMutation({ mutationFn: api.admin.wakeEnrichment, ...opts }),
  }
}

export function useApiKeys(enabled = true) {
  return useQuery({ queryKey: ['api-keys'], queryFn: api.apiKeys, enabled })
}

/** Household + admin mutations; every one refreshes what it touches (and auth, for names/Sous). */
export function useHouseholdActions() {
  const qc = useQueryClient()
  const refresh = (...keys: string[]) => () => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
  return {
    rename: useMutation({ mutationFn: api.renameHousehold, onSuccess: refresh('household', 'auth') }),
    renamePerson: useMutation({
      mutationFn: ({ id, name }: { id: number; name: string }) => api.renamePerson(id, name),
      onSuccess: refresh('household', 'auth'),
    }),
    setRole: useMutation({
      mutationFn: ({ id, role }: { id: number; role: Role }) => api.setPersonRole(id, role),
      onSuccess: refresh('household', 'auth'),
      meta: { ownErrors: true },
    }),
    createJoinInvite: useMutation({ mutationFn: api.createJoinInvite, onSuccess: refresh('household') }),
    deleteJoinInvite: useMutation({ mutationFn: api.deleteJoinInvite, onSuccess: refresh('household') }),
    createApiKey: useMutation({ mutationFn: api.createApiKey, onSuccess: refresh('api-keys') }),
    revokeApiKey: useMutation({ mutationFn: api.revokeApiKey, onSuccess: refresh('api-keys') }),
  }
}

/** Redeeming a code turns an unlinked account into a member: refresh everything. */
export function useRedeemInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, name }: { code: string; name: string }) => api.redeemInvite(code, name),
    meta: { ownErrors: true },
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.logout(),
    // Everything cached (and any persisted X-Person pick or offline queue) belonged to that session's household.
    onSuccess: () => {
      clearOfflineQueue()
      clearSwApiCache()
      pickPerson(null)
      qc.clear()
      qc.invalidateQueries({ queryKey: ['auth'] })
    },
  })
}

export function useRecipes(source: string, q: string) {
  return useQuery({ queryKey: ['recipes', source, q], queryFn: () => api.recipes(source, q) })
}

export function useRecipe(id: string | undefined) {
  return useQuery({ queryKey: ['recipe', id], queryFn: () => api.recipe(id!), enabled: !!id })
}

/** Unscaled base recipe (?base=true) for the edit screen so edits never save scaled portions as base. */
export function useRecipeBase(id: string | undefined) {
  return useQuery({ queryKey: ['recipe', id, 'base'], queryFn: () => api.recipeBase(id!), enabled: !!id, staleTime: 0 })
}

export function usePantry() {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['pantry'], queryFn: api.pantry, enabled: canEdit })
}

const livePollOptions = {
  refetchInterval: () =>
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    navigator.onLine &&
    readOfflineQueue().length === 0
      ? 6_000
      : false,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const

export function useShopping(opts?: { live?: boolean }) {
  const { canEdit } = useAuth()
  return useQuery({
    queryKey: ['shopping'],
    queryFn: api.shopping,
    enabled: canEdit,
    ...(opts?.live ? livePollOptions : undefined),
  })
}

export function useSupplies(opts?: { live?: boolean }) {
  const { canEdit } = useAuth()
  return useQuery({
    queryKey: ['supplies'],
    queryFn: api.supplies,
    enabled: canEdit,
    ...(opts?.live ? livePollOptions : undefined),
  })
}

/** Only fetched while the "Zarządzaj częstymi" panel is open. */
export function useAllHotSupplies(enabled: boolean) {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['supplies', 'hot', 'all'], queryFn: api.allHotSupplies, enabled: canEdit && enabled })
}

export function usePreferences() {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['preferences'], queryFn: api.preferences, enabled: canEdit })
}

export function useCookbook() {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['cookbook'], queryFn: api.cookbook, enabled: canEdit })
}

export function useQuestionnaire() {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['questionnaire'], queryFn: api.questionnaire, enabled: canEdit })
}

export function useCookLog(recipeId?: string, limit?: number) {
  const { canEdit } = useAuth()
  return useQuery({
    queryKey: ['cooklog', recipeId ?? 'all', limit ?? 'default'],
    queryFn: () => api.cookLog(recipeId, limit),
    enabled: canEdit,
  })
}

export function usePlan(start?: string, enabled = true) {
  const { isLoading } = useAuth()
  const { id } = usePerson()
  return useQuery({ queryKey: ['plan', id, start ?? 'current'], queryFn: () => api.plan(start), enabled: !isLoading && enabled })
}

/** Past plan entries never logged as cooked — drives the login reminder modal. */
export function usePendingCook(enabled: boolean) {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['pendingCook'], queryFn: api.pendingCook, enabled: canEdit && enabled })
}

export function useDismissCookReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.dismissCookReminder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pendingCook'] }),
  })
}

export function useConnectInfo() {
  const { canEdit } = useAuth()
  return useQuery({ queryKey: ['connect'], queryFn: api.connectInfo, enabled: canEdit })
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
/** Mutations whose call site shows its own failure message; the global "nie udało się" toast skips them. */
const OWN_ERRORS = { ownErrors: true }

function usePantryMutation<TArgs, TData = unknown>(mutationFn: (args: TArgs) => Promise<TData>, meta?: typeof OWN_ERRORS) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    meta,
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
  return usePantryMutation((input: PantryItemInput) => api.addPantry(input), OWN_ERRORS)
}

export function useAdjustPantry() {
  return usePantryMutation(
    ({ items, merchant }: { items: PantryAdjustItem[]; merchant?: string }) => api.adjustPantry(items, merchant),
    OWN_ERRORS,
  )
}

export function useDeletePantry() {
  return usePantryMutation((id: string) => api.deletePantry(id))
}

export function useCheckShopping() {
  const qc = useQueryClient()
  return useMutation({
    onMutate: async (input: string | { id: string; checked: boolean }) => {
      const id = typeof input === 'string' ? input : input.id
      await qc.cancelQueries({ queryKey: ['shopping'] })
      const prev = qc.getQueryData<ShoppingList>(['shopping'])
      if (prev) {
        const items = prev.items.map((item) => {
          if (item.id !== id) return item
          const checked = typeof input === 'string' ? !item.checked : input.checked
          return { ...item, checked }
        })
        qc.setQueryData<ShoppingList>(['shopping'], {
          ...prev,
          items,
          checkedCount: items.filter((i) => i.checked).length,
        })
      }
      return { prev }
    },
    mutationFn: async (input: string | { id: string; checked: boolean }) => {
      const id = typeof input === 'string' ? input : input.id
      const targetChecked = typeof input === 'string'
        ? qc.getQueryData<ShoppingList>(['shopping'])?.items.find((s) => s.id === id)?.checked
        : input.checked
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueOfflineAction({ kind: 'shopping-check', id, checked: targetChecked ?? true })
        return { queued: true as const }
      }
      try {
        const item = await api.checkShopping(id, targetChecked)
        return { queued: false as const, item }
      } catch (err) {
        if (isNetworkError(err)) {
          enqueueOfflineAction({ kind: 'shopping-check', id, checked: targetChecked ?? true })
          return { queued: true as const }
        }
        throw err
      }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['shopping'], ctx.prev)
    },
    onSuccess: (res) => {
      if (!res.queued) qc.invalidateQueries({ queryKey: ['shopping'] })
    },
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
    onMutate: async ({ name, category }: { name: string; category?: string }) => {
      await qc.cancelQueries({ queryKey: ['shopping'] })
      const prev = qc.getQueryData<ShoppingList>(['shopping'])
      if (prev) {
        const optimistic: ShoppingItem = {
          id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name,
          category: category ?? 'Other',
          reason: 'Dodane ręcznie',
          checked: false,
          origin: 'manual',
          quantity: null,
          unit: null,
          recipes: [],
          pantryItemId: null,
        }
        qc.setQueryData<ShoppingList>(['shopping'], {
          ...prev,
          items: [optimistic, ...prev.items],
          total: prev.total + 1,
        })
      }
      return { prev }
    },
    mutationFn: async ({ name, category }: { name: string; category?: string }) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueOfflineAction({ kind: 'shopping-add', name, category })
        return { queued: true as const }
      }
      try {
        const item = await api.addShopping(name, category)
        return { queued: false as const, item }
      } catch (err) {
        if (isNetworkError(err)) {
          enqueueOfflineAction({ kind: 'shopping-add', name, category })
          return { queued: true as const }
        }
        throw err
      }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['shopping'], ctx.prev)
    },
    onSuccess: (res) => {
      if (!res.queued) qc.invalidateQueries({ queryKey: ['shopping'] })
    },
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
  const qc = useQueryClient()
  return useMutation({
    onMutate: async ({ name, category }: { name: string; category?: SupplyCategory }) => {
      await qc.cancelQueries({ queryKey: ['supplies'] })
      const prev = qc.getQueryData<SupplyList>(['supplies'])
      if (prev) {
        const optimistic: SupplyItem = {
          id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name,
          category: category ?? 'other',
          checked: false,
        }
        qc.setQueryData<SupplyList>(['supplies'], {
          ...prev,
          items: [optimistic, ...prev.items],
          total: prev.total + 1,
        })
      }
      return { prev }
    },
    mutationFn: async ({ name, category }: { name: string; category?: SupplyCategory }) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueOfflineAction({ kind: 'supply-add', name, category })
        return { queued: true as const }
      }
      try {
        const item = await api.addSupply(name, category)
        return { queued: false as const, item }
      } catch (err) {
        if (isNetworkError(err)) {
          enqueueOfflineAction({ kind: 'supply-add', name, category })
          return { queued: true as const }
        }
        throw err
      }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['supplies'], ctx.prev)
    },
    onSuccess: (res) => {
      if (!res.queued) qc.invalidateQueries({ queryKey: ['supplies'] })
    },
  })
}

export function useCheckSupply() {
  const qc = useQueryClient()
  return useMutation({
    onMutate: async (input: string | { id: string; checked: boolean }) => {
      const id = typeof input === 'string' ? input : input.id
      await qc.cancelQueries({ queryKey: ['supplies'] })
      const prev = qc.getQueryData<SupplyList>(['supplies'])
      if (prev) {
        const items = prev.items.map((item) => {
          if (item.id !== id) return item
          const checked = typeof input === 'string' ? !item.checked : input.checked
          return { ...item, checked }
        })
        qc.setQueryData<SupplyList>(['supplies'], {
          ...prev,
          items,
          checkedCount: items.filter((i) => i.checked).length,
        })
      }
      return { prev }
    },
    mutationFn: async (input: string | { id: string; checked: boolean }) => {
      const id = typeof input === 'string' ? input : input.id
      const targetChecked = typeof input === 'string'
        ? qc.getQueryData<SupplyList>(['supplies'])?.items.find((s) => s.id === id)?.checked
        : input.checked
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueOfflineAction({ kind: 'supply-check', id, checked: targetChecked ?? true })
        return { queued: true as const }
      }
      try {
        const item = await api.checkSupply(id, targetChecked)
        return { queued: false as const, item }
      } catch (err) {
        if (isNetworkError(err)) {
          enqueueOfflineAction({ kind: 'supply-check', id, checked: targetChecked ?? true })
          return { queued: true as const }
        }
        throw err
      }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['supplies'], ctx.prev)
    },
    onSuccess: (res) => {
      if (!res.queued) qc.invalidateQueries({ queryKey: ['supplies'] })
    },
  })
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
    // The count and kcal follow the tap at once; scaled amounts arrive with the refetch.
    onMutate: ({ id, servings }) => {
      qc.setQueryData<RecipeDetail>(['recipe', id], (old) => (old ? { ...old, selectedServings: servings } : old))
    },
    onError: (_e, { id }) => qc.invalidateQueries({ queryKey: ['recipe', id] }),
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
    meta: OWN_ERRORS,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
    },
  })
}

export function useUpdateRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecipeInput }) => api.updateRecipe(id, input),
    meta: OWN_ERRORS,
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['recipe', id] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
      qc.invalidateQueries({ queryKey: ['cookProposal', id] })
      qc.invalidateQueries({ queryKey: ['plan'] })
    },
  })
}

export function useSetRecipeNutrition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecipeNutritionInput }) => api.setRecipeNutrition(id, input),
    meta: OWN_ERRORS,
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['recipe', id] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
      qc.invalidateQueries({ queryKey: ['plan'] })
    },
  })
}

export function useSetRecipeFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => api.setRecipeFavorite(id, favorite),
    onMutate: ({ id, favorite }) => {
      qc.setQueryData<RecipeDetail>(['recipe', id], (old) => (old ? { ...old, isFavorite: favorite } : old))
      qc.setQueriesData<RecipeListItem[]>({ queryKey: ['recipes'] }, (old) =>
        old?.map((r) => (r.id === id ? { ...r, isFavorite: favorite } : r)),
      )
    },
    onError: (_e, { id }) => {
      qc.invalidateQueries({ queryKey: ['recipe', id] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
    },
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['recipe', id] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
    },
  })
}

export function useSetRecipeTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) => api.setRecipeTags(id, tags),
    meta: OWN_ERRORS,
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: ['recipe', id] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
    },
  })
}

export function useRecipeShare(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['recipeShare', id],
    queryFn: () => api.recipeShare(id!),
    enabled: !!id && enabled,
    staleTime: 0,
  })
}

export function useCreateRecipeShare() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.createRecipeShare(id),
    meta: OWN_ERRORS,
    onSuccess: (data, id) => {
      qc.setQueryData(['recipeShare', id], data)
    },
  })
}

export function useRevokeRecipeShare() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.revokeRecipeShare(id),
    meta: OWN_ERRORS,
    onSuccess: (_res, id) => {
      qc.setQueryData(['recipeShare', id], { active: false, token: null, path: null, createdAt: null, expiresAt: null })
    },
  })
}

export function useSharedRecipe(token: string | undefined) {
  return useQuery({
    queryKey: ['sharedRecipe', token],
    queryFn: () => api.sharedRecipe(token!),
    enabled: !!token,
    retry: false,
  })
}

export function useImportSharedRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => api.importSharedRecipe(token),
    meta: OWN_ERRORS,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['cookbook'] })
    },
  })
}

export function useUploadRecipeImageFromUrl() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, url }: { id: string; url: string }) => api.uploadRecipeImageFromUrl(id, url),
    meta: OWN_ERRORS,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe'] })
    },
  })
}

export function useImportUrl() {
  return useMutation({
    mutationFn: (url: string) => api.importUrl(url),
    meta: OWN_ERRORS,
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
    meta: OWN_ERRORS,
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
      qc.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}

// ---- diary (private: never fetched anonymously — /diary would 401) ----

export function useFridge(today: string) {
  const { canEdit } = useAuth()
  const { id } = usePerson()
  return useQuery({ queryKey: ['fridge', id, today], queryFn: () => api.fridge(today), enabled: canEdit })
}

export function useCook(id: string | null) {
  return useQuery({ queryKey: ['cook', id], queryFn: () => api.cook(id!), enabled: !!id })
}

export function useFoodFavorites(enabled: boolean) {
  const { id } = usePerson()
  return useQuery({ queryKey: ['foodFavorites', id], queryFn: api.foodFavorites, enabled })
}

// ---- body / budget / progress (private like the diary) ----

export function useBody() {
  const { canEdit } = useAuth()
  const { id } = usePerson()
  return useQuery({ queryKey: ['body', id], queryFn: api.body, enabled: canEdit })
}

/**
 * Grammatical gender for diary copy („Zjadłaś” / „Zjadłeś”), from the shown person's goal.
 * Feminine until a goal is set — the diary started as hers.
 */
export function useFeminine() {
  const { data } = useBody()
  return !data?.configured || data.sex === 'female'
}

export function useCatering() {
  const { canEdit } = useAuth()
  const { id } = usePerson()
  return useQuery({ queryKey: ['catering', id], queryFn: api.catering, enabled: canEdit })
}

export function useBudget(start: string, days = 7) {
  const { canEdit } = useAuth()
  const { id } = usePerson()
  return useQuery({ queryKey: ['budget', id, start, days], queryFn: () => api.budget(start, days), enabled: canEdit })
}

export function useProgress(days: number) {
  const { canEdit } = useAuth()
  const { id } = usePerson()
  return useQuery({ queryKey: ['progress', id, days], queryFn: () => api.progress(days), enabled: canEdit })
}

export function useActivity(days = 7) {
  const { canEdit } = useAuth()
  const { id } = usePerson()
  return useQuery({ queryKey: ['activity', id, days], queryFn: () => api.activity(days), enabled: canEdit })
}

export function useHealthConnection(enabled: boolean) {
  const { id } = usePerson()
  return useQuery({ queryKey: ['healthConnection', id], queryFn: api.healthConnection, enabled })
}

export function useRotateHealthConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.rotateHealthConnection,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['healthConnection'] })
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

export function useStravaStatus(enabled: boolean) {
  const { id } = usePerson()
  return useQuery({ queryKey: ['strava', id], queryFn: api.stravaStatus, enabled })
}

/** Gets Strava's consent URL and leaves for it; Strava comes back to /plan/aktywnosc?strava=…. */
export function useConnectStrava() {
  return useMutation({ mutationFn: api.connectStrava, onSuccess: ({ url }) => window.location.assign(url) })
}

export function useSyncStrava() {
  const qc = useQueryClient()
  const onActivity = useActivityInvalidation()
  return useMutation({
    mutationFn: api.syncStrava,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['strava'] })
      onActivity()
    },
  })
}

export function useDisconnectStrava() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.disconnectStrava,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strava'] }),
  })
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

/** Saving catering can write today's box, so the diary refreshes too. */
export function useSaveCatering() {
  const qc = useQueryClient()
  const diary = useDiaryInvalidation()
  return useMutation({
    mutationFn: (input: CateringInput) => api.saveCatering(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catering'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      diary()
    },
  })
}

export function useAddCateringPause() {
  const qc = useQueryClient()
  const diary = useDiaryInvalidation()
  return useMutation({
    mutationFn: (input: CateringPauseInput) => api.addCateringPause(input),
    meta: OWN_ERRORS,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catering'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      diary()
    },
  })
}

export function useDeleteCateringPause() {
  const qc = useQueryClient()
  const diary = useDiaryInvalidation()
  return useMutation({
    mutationFn: (id: string) => api.deleteCateringPause(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catering'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      diary()
    },
  })
}

export function useLogCatering() {
  const onSuccess = useDiaryInvalidation()
  return useMutation({ mutationFn: (date: string) => api.logCatering(date), onSuccess })
}

export function useDeleteCateringDay() {
  const qc = useQueryClient()
  const diary = useDiaryInvalidation()
  return useMutation({
    mutationFn: (date: string) => api.deleteCateringDay(date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] })
      diary()
    },
  })
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
