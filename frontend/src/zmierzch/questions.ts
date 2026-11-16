import type { Question } from './types'

// Every questions/*.json file is an array of Question; new batch files are picked up automatically.
// Shape and content are checked by `npm run test:zmierzch` (tests/zmierzch-data.mjs).
const files = import.meta.glob<Question[]>('./questions/*.json', { eager: true, import: 'default' })

export const QUESTIONS: Question[] = Object.keys(files)
  .sort()
  .flatMap((k) => files[k])
