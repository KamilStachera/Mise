import type { ActivityLevel, BodySex } from '../api/client'

// Live preview for the „Twój cel” form. Mirrors backend Services/BodyService.Targets — the
// backend is the source of truth (it recomputes on save); keep the two in step.

const FACTOR: Record<ActivityLevel, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725 }
const KCAL_PER_KG = 7700
const roundTo = (v: number, step: number) => Math.round(v / step) * step

export function previewTargets(p: { sex: BodySex; birthYear: number; heightCm: number; kg: number; activityLevel: ActivityLevel; paceKg: number }) {
  const age = Math.min(100, Math.max(14, new Date().getFullYear() - p.birthYear))
  const bmr = Math.round(10 * p.kg + 6.25 * p.heightCm - 5 * age + (p.sex === 'male' ? 5 : -161))
  const tdee = Math.round(bmr * FACTOR[p.activityLevel])
  const floor = p.sex === 'male' ? 1500 : 1200
  const target = Math.max(floor, roundTo(tdee - (p.paceKg * KCAL_PER_KG) / 7, 10))
  const protein = roundTo(p.kg * 1.6, 5)
  return { bmr, tdee, target, protein }
}
