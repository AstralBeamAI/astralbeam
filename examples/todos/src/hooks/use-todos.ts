import { useMemo, useSyncExternalStore } from "react"

import { INITIAL_TODOS } from "@/lib/constants.ts"
import { createTodoFromToolInput } from "@/lib/todo-tools.ts"
import type { Todo } from "@/lib/types.ts"

const storageKey = "astralbeam-example-todos"
const changeEvent = "todos-changed"
const initialState = {
  todos: INITIAL_TODOS,
  nextId: Math.max(0, ...INITIAL_TODOS.map((todo) => todo.id)) + 1,
}

function readState(snapshot: string | null): typeof initialState {
  if (!snapshot) return initialState
  try {
    const state = JSON.parse(snapshot) as typeof initialState | null
    if (
      state &&
      Number.isSafeInteger(state.nextId) &&
      state.nextId > 0 &&
      Array.isArray(state.todos) &&
      state.todos.every(
        (todo: Todo) =>
          todo &&
          Number.isSafeInteger(todo.id) &&
          todo.id > 0 &&
          todo.id < state.nextId &&
          typeof todo.text === "string" &&
          typeof todo.completed === "boolean",
      )
    )
      return state
  } catch {
    // Invalid browser data should not prevent the demo from opening.
  }
  return initialState
}

const getSnapshot = () => localStorage.getItem(storageKey)
const getServerSnapshot = () => null
const getState = () => readState(getSnapshot())

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) onChange()
  }
  window.addEventListener("storage", onStorage)
  window.addEventListener(changeEvent, onChange)
  return () => {
    window.removeEventListener("storage", onStorage)
    window.removeEventListener(changeEvent, onChange)
  }
}

function save(state: typeof initialState) {
  localStorage.setItem(storageKey, JSON.stringify(state))
  window.dispatchEvent(new Event(changeEvent))
}

export function useTodos() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const { todos } = useMemo(() => readState(snapshot), [snapshot])
  return {
    todos,
    getTodos: () => getState().todos,
    setTodos: (update: (current: Todo[]) => Todo[]) => {
      const state = getState()
      save({ ...state, todos: update(state.todos) })
    },
    createTodo: (input: Record<string, unknown>) => {
      const state = getState()
      const todo = createTodoFromToolInput({ id: state.nextId, input })
      save({ todos: [...state.todos, todo], nextId: state.nextId + 1 })
      return todo
    },
  }
}
