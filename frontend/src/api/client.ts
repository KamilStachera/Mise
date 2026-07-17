// ---- API types (mirror the backend DTOs) ----
export type Source = 'ai' | 'web' | 'manual'
export type Status = 'in' | 'low' | 'out' | 'unknown'
export type Unit = 'g' | 'ml' | 'szt'
export type DishType = 'breakfast' | 'main' | 'soup' | 'salad' | 'side' | 'dessert' | 'snack' | 'baking'
export type Cuisine =
  | 'polish' | 'italian' | 'french' | 'spanish' | 'greek' | 'mediterranean' | 'middleeastern'
  | 'indian' | 'thai' | 'vietnamese' | 'chinese' | 'japanese' | 'korean' | 'mexican' | 'american' | 'other'

export interface RecipeListItem {
  id: string
  title: string
  source: Source
  time: number
  servings: number
  difficulty: string
  tint: string
  blurb: string
  imageUrl: string | null
  toBuyCount: number
  dishType: DishType | null
  cuisine: Cuisine | null
  usesAirFryer: boolean
  createdAt: string
  /** Estimated nutrition per serving; null = not yet estimated. */
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
}

export interface Ingredient {
  name: string
  quantity: string
  displayText: string | null
  alternativeGroup: string | null
  status: Status
}

/** One gallery photo; the default one is shown on cards and the hero. */
export interface RecipeImage {
  id: string
  url: string
  isDefault: boolean
  createdAt: string
}

export interface RecipeDetail {
  id: string
  title: string
  source: Source
  time: number
  servings: number
  difficulty: string
  tint: string
  blurb: string
  imageUrl: string | null
  images: RecipeImage[]
  tip: string | null
  ingredients: Ingredient[]
  steps: string[]
  have: number
  total: number
  missing: string[]
  dishType: DishType | null
  cuisine: Cuisine | null
  usesAirFryer: boolean
  /** Estimated nutrition per serving; null = not yet estimated. */
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
}

export interface PantryItem {
  id: string
  name: string
  category: string
  unit: Unit
  quantity: number
  lowThreshold: number | null
  /** Derived from quantity: 0 = out, below threshold = low. */
  status: Status
  aliases: string[]
}
export interface PantryGroup {
  category: string
  items: PantryItem[]
}
export interface PantryItemInput {
  name: string
  category: string
  unit: Unit
  quantity?: number
  lowThreshold?: number | null
  aliases?: string[]
}

export interface ShoppingItem {
  id: string
  name: string
  category: string
  reason: string
  checked: boolean
  origin: string
  quantity: number | null
  unit: Unit | null
}
export interface ShoppingList {
  items: ShoppingItem[]
  total: number
  checkedCount: number
}

/** One row of the "Ugotowane!" confirm dialog — what would be deducted and why not. */
export interface CookProposalItem {
  ingredientId: string
  name: string
  quantityText: string
  displayText: string | null
  alternativeGroup: string | null
  pantryItemId: string | null
  pantryItemName: string | null
  unit: Unit | null
  pantryQuantity: number | null
  proposedAmount: number | null
  deductible: boolean
  skipReason: 'unlinked' | 'unparsed' | 'unit-mismatch' | 'alternative-not-selected' | null
}
export interface CookProposal {
  recipeId: string
  title: string
  items: CookProposalItem[]
}

export interface Equipment {
  name: string
  favorite: boolean
}
export interface Preferences {
  householdSummary: string
  householdDetail: string
  skillSummary: string
  skillDetail: string
  tasteCuisines: string
  avoidDietary: string
  equipmentNote: string
  equipment: Equipment[]
}

export interface ChatHealth {
  enabled: boolean
  provider: string
}
export interface ChatMessage {
  id: string
  role: 'ai' | 'user'
  content: string
  createdAt: string
}

export interface RecipeInput {
  title: string
  source: Source
  time: number
  servings: number
  difficulty?: string
  tint?: string
  blurb?: string
  tip?: string
  ingredients: {
    name: string
    quantity?: string
    displayText?: string
    alternativeGroup?: string
    amountValue?: number
    amountUnit?: Unit
  }[]
  steps: string[]
  dishType?: DishType
  cuisine?: Cuisine
  /** Omitted = the backend guesses from the recipe text. */
  usesAirFryer?: boolean
  /** Estimated nutrition per serving; omitted on PUT clears the stored values. */
  kcal?: number
  protein?: number
  fat?: number
  carbs?: number
}

export interface CookLogEntry {
  id: string
  recipeId: string | null
  dishName: string
  rating: number | null
  note: string
  cookedAt: string // YYYY-MM-DD
}
export interface CookDeduction {
  pantryItemId: string
  amount: number
}
export interface CookLogInput {
  recipeId?: string
  dishName?: string
  rating?: number
  note?: string
  cookedAt?: string
  deductions?: CookDeduction[]
}
export interface CookLogResult {
  entry: CookLogEntry
  deducted: { pantryItemId: string; name: string; deducted: number; newQuantity: number; status: Status }[]
}

export type Slot = 'breakfast' | 'lunch' | 'dinner'
export interface PlanEntry {
  id: string
  date: string // YYYY-MM-DD
  slot: Slot
  recipeId: string | null
  recipeTitle: string | null
  title: string
  note: string
}
export interface PlanRange {
  start: string
  days: number
  entries: PlanEntry[]
}
export interface PlanEntryInput {
  date: string
  slot: Slot
  recipeId?: string | null
  title?: string
  note?: string
}

export interface Question {
  key: string
  label: string
  type: 'text' | 'longtext' | 'choice' | 'scale'
  options: string[] | null
  placeholder: string | null
}
export interface QuestionnaireSection {
  key: string
  title: string
  questions: Question[]
}
export interface Questionnaire {
  sections: QuestionnaireSection[]
  answers: Record<string, string>
}

export interface ConnectInfo {
  apiBase: string
  contextPath: string
  hostContextPath: string | null
  prompts: {
    oneShot: string
    globalSnippet: string
    commandsInstall: string
    claudeMcpCommand: string
    codexMcpToml: string
  }
}

export interface AuthMe {
  authenticated: boolean
  email: string | null
  name: string | null
  picture: string | null
}

// ---- fetch helpers ----
const BASE = '/api'

/** Carries the HTTP status so callers can react to 401 (session expired / read-only). */
export class ApiError extends Error {
  status: number
  constructor(status: number, statusText: string) {
    super(`${status} ${statusText}`)
    this.status = status
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new ApiError(res.status, res.statusText)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  recipes: (source?: string, q?: string) => {
    const p = new URLSearchParams()
    if (source && source !== 'all') p.set('source', source)
    if (q) p.set('q', q)
    const qs = p.toString()
    return http<RecipeListItem[]>(`/recipes${qs ? '?' + qs : ''}`)
  },
  recipe: (id: string) => http<RecipeDetail>(`/recipes/${id}`),
  createRecipe: (input: RecipeInput) =>
    http<{ id: string }>(`/recipes`, { method: 'POST', body: JSON.stringify(input) }),
  deleteRecipe: (id: string) => http<void>(`/recipes/${id}`, { method: 'DELETE' }),
  addMissingToShopping: (id: string) =>
    http<{ added: number; updated: number }>(`/recipes/${id}/add-missing-to-shopping`, { method: 'POST' }),
  // Multipart — bypasses the JSON `http` helper so the browser sets the boundary header.
  uploadRecipeImage: async (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/recipes/${id}/image`, { method: 'POST', body: form })
    if (!res.ok) throw new ApiError(res.status, res.statusText)
    return (await res.json()) as { imageId: string; imageUrl: string; images: RecipeImage[] }
  },
  deleteRecipeImage: (id: string, imageId: string) =>
    http<{ images: RecipeImage[] }>(`/recipes/${id}/images/${imageId}`, { method: 'DELETE' }),
  setDefaultRecipeImage: (id: string, imageId: string) =>
    http<{ images: RecipeImage[] }>(`/recipes/${id}/images/${imageId}/default`, { method: 'PUT' }),

  pantry: () => http<PantryGroup[]>(`/pantry`),
  setPantryQuantity: (id: string, quantity: number) =>
    http<PantryItem>(`/pantry/${id}/quantity`, { method: 'PATCH', body: JSON.stringify({ quantity }) }),
  updatePantry: (id: string, input: PantryItemInput) =>
    http<PantryItem>(`/pantry/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  addPantry: (input: PantryItemInput) =>
    http<PantryItem>(`/pantry`, { method: 'POST', body: JSON.stringify(input) }),
  deletePantry: (id: string) => http<void>(`/pantry/${id}`, { method: 'DELETE' }),

  shopping: () => http<ShoppingList>(`/shopping`),
  checkShopping: (id: string) => http<ShoppingItem>(`/shopping/${id}/check`, { method: 'PATCH' }),
  addShopping: (name: string, category?: string) =>
    http<ShoppingItem>(`/shopping`, { method: 'POST', body: JSON.stringify({ name, category }) }),
  deleteShopping: (id: string) => http<void>(`/shopping/${id}`, { method: 'DELETE' }),
  clearChecked: () => http<{ removed: number }>(`/shopping/clear-checked`, { method: 'POST' }),

  preferences: () => http<Preferences>(`/preferences`),
  savePreferences: (p: Preferences) =>
    http<Preferences>(`/preferences`, { method: 'PUT', body: JSON.stringify(p) }),

  questionnaire: () => http<Questionnaire>(`/profile/questionnaire`),
  saveAnswers: (answers: Record<string, string>) =>
    http<{ answers: Record<string, string> }>(`/profile/answers`, { method: 'PUT', body: JSON.stringify({ answers }) }),

  cookProposal: (id: string) => http<CookProposal>(`/recipes/${id}/cook-proposal`),

  cookLog: (recipeId?: string, limit?: number) => {
    const p = new URLSearchParams()
    if (recipeId) p.set('recipeId', recipeId)
    if (limit) p.set('limit', String(limit))
    const qs = p.toString()
    return http<CookLogEntry[]>(`/cooklog${qs ? '?' + qs : ''}`)
  },
  addCookLog: (input: CookLogInput) =>
    http<CookLogResult>(`/cooklog`, { method: 'POST', body: JSON.stringify(input) }),
  deleteCookLog: (id: string) => http<void>(`/cooklog/${id}`, { method: 'DELETE' }),

  plan: (start?: string, days?: number) => {
    const p = new URLSearchParams()
    if (start) p.set('start', start)
    if (days) p.set('days', String(days))
    const qs = p.toString()
    return http<PlanRange>(`/plan${qs ? '?' + qs : ''}`)
  },
  setPlanEntry: (input: PlanEntryInput) =>
    http<PlanEntry>(`/plan/entry`, { method: 'PUT', body: JSON.stringify(input) }),
  deletePlanEntry: (id: string) => http<void>(`/plan/entry/${id}`, { method: 'DELETE' }),
  planAddMissing: (start: string, days: number) =>
    http<{ added: number; updated: number }>(`/plan/add-missing-to-shopping`, { method: 'POST', body: JSON.stringify({ start, days }) }),

  cookbook: () => http<{ markdown: string }>(`/context/cookbook`),
  contextStatus: () => http<{ path: string; hostPath: string | null }>(`/context/status`),
  connectInfo: () => http<ConnectInfo>(`/context/connect`),
  exportContext: () =>
    http<{ path: string; files: string[]; exportedAt: string }>(`/context/export`, { method: 'POST' }),

  chatHealth: () => http<ChatHealth>(`/chat/health`),
  chatHistory: () => http<ChatMessage[]>(`/chat/history`),

  authMe: () => http<AuthMe>(`/auth/me`),
  logout: () => http<void>(`/auth/logout`, { method: 'POST' }),
}

/** Full-page navigation into the Google OAuth flow; comes back to `returnUrl`. */
export function loginUrl(returnUrl: string): string {
  return `${BASE}/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`
}

// ---- chat SSE streaming ----
export async function streamChat(
  message: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  })
  if (!res.ok || !res.body) throw new ApiError(res.status, res.statusText || 'chat')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      try {
        const payload = JSON.parse(line.slice('data:'.length).trim())
        if (payload.delta) onDelta(payload.delta as string)
        if (payload.error) throw new Error('stream interrupted')
      } catch (e) {
        if (e instanceof Error && e.message === 'stream interrupted') throw e
        /* ignore malformed frames */
      }
    }
  }
}
