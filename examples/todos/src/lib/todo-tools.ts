import type { Todo } from "./types.ts"

export function findTodo({ id, todos }: { id: unknown; todos: Todo[] }) {
  const todoId = Number(id)
  if (!Number.isSafeInteger(todoId)) throw new Error("A todo needs a valid id")
  const todo = todos.find((candidate) => candidate.id === todoId)
  if (!todo) throw new Error(`No todo with id ${todoId}`)
  return todo
}

export function createTodoFromToolInput({
  id,
  input,
}: {
  id: number
  input: Record<string, unknown>
}) {
  const text = typeof input.text === "string" ? input.text.trim() : ""
  if (!text) throw new Error("A todo needs a non-empty text")
  return { id, text, completed: input.completed === true } satisfies Todo
}

export function updateTodoFromToolInput({
  input,
  todos,
}: {
  input: Record<string, unknown>
  todos: Todo[]
}) {
  const todo = findTodo({ id: input.id, todos })
  // Missing and explicit null both mean "unchanged"; coercing null would corrupt the todo.
  const text =
    input.text == null ? todo.text : typeof input.text === "string" ? input.text.trim() : ""
  if (!text) throw new Error("A todo needs a non-empty text")
  return {
    ...todo,
    text,
    completed: input.completed == null ? todo.completed : Boolean(input.completed),
  } satisfies Todo
}
