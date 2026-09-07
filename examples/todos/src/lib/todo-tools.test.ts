import { expect, test } from "vitest"

import { createTodoFromToolInput, updateTodoFromToolInput } from "./todo-tools.ts"

const todos = [{ id: 1, text: "Water the plants", completed: false }]

// Tool input arrives from a model, so an omitted or null field must leave the todo alone rather
// than being coerced into an empty string or `false`.
test("an update leaves fields the model did not send alone", () => {
  expect(updateTodoFromToolInput({ input: { id: 1 }, todos })).toEqual({
    id: 1,
    text: "Water the plants",
    completed: false,
  })
  expect(updateTodoFromToolInput({ input: { id: 1, text: null, completed: true }, todos })).toEqual(
    {
      id: 1,
      text: "Water the plants",
      completed: true,
    },
  )
})

test("a todo cannot be created or updated into an empty text", () => {
  expect(() => createTodoFromToolInput({ id: 2, input: { text: "   " } })).toThrow(/non-empty/)
  expect(() => updateTodoFromToolInput({ input: { id: 1, text: " " }, todos })).toThrow(/non-empty/)
})

test("an update refuses an id that is not a todo", () => {
  expect(() => updateTodoFromToolInput({ input: { id: 99 }, todos })).toThrow(/No todo with id 99/)
  expect(() => updateTodoFromToolInput({ input: { id: "abc" }, todos })).toThrow(/valid id/)
})
