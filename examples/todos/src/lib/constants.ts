import type { Todo } from "./types.ts"

export const COLOR_SCHEME_CYCLE = ["system", "light", "dark"] as const

export const INITIAL_TODOS: Todo[] = [
  { id: 1, text: "Write the launch announcement", completed: false },
  { id: 2, text: "Review the open pull requests", completed: false },
  { id: 3, text: "Book the offsite venue", completed: true },
]
