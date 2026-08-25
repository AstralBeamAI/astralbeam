import type { Todo } from "./types.ts"

function readTodoId(input: Record<string, unknown>) {
  const id = Number(input.id)
  if (!Number.isSafeInteger(id)) throw new Error("A todo needs a valid id")
  return id
}

function findTodo({ id, todos }: { id: number; todos: Todo[] }) {
  const todo = todos.find((candidate) => candidate.id === id)
  if (!todo) throw new Error(`No todo with id ${id}`)
  return todo
}

export function createTodoFromToolInput(
  { id, input }: { id: number; input: Record<string, unknown> },
) {
  const text = String(input.text ?? "").trim()
  if (!text) throw new Error("A todo needs a non-empty text")
  return { id, text, completed: input.completed === true } satisfies Todo
}

export function updateTodoFromToolInput(
  { input, todos }: { input: Record<string, unknown>; todos: Todo[] },
) {
  const todo = findTodo({ id: readTodoId(input), todos })
  // Missing and explicit null both mean "unchanged"; coercing null would corrupt the todo.
  const text = input.text == null ? todo.text : String(input.text).trim()
  if (!text) throw new Error("A todo needs a non-empty text")
  return {
    ...todo,
    text,
    completed: input.completed == null ? todo.completed : Boolean(input.completed),
  } satisfies Todo
}

export function deleteTodoFromToolInput(
  { input, todos }: { input: Record<string, unknown>; todos: Todo[] },
) {
  return findTodo({ id: readTodoId(input), todos })
}
