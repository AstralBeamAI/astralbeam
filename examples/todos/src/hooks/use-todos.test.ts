import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { useTodos } from "./use-todos.ts"

afterEach(() => vi.unstubAllGlobals())

test("a stale card toggle preserves other todos and their next id", () => {
  const storage = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  vi.stubGlobal("window", new EventTarget())
  let store: ReturnType<typeof useTodos> | undefined
  function CaptureStore() {
    store = useTodos()
    return null
  }
  renderToStaticMarkup(createElement(CaptureStore))
  if (!store) throw new Error("The hook did not render")
  const todo = store.createTodo({ text: "Remove this todo" })
  store.deleteTodo({ id: todo.id })
  const remaining = store.getTodos()
  store.toggleTodo(todo.id)
  expect(store.getTodos()).toEqual(remaining)
  expect(store.createTodo({ text: "Keep the next id" }).id).toBe(todo.id + 1)
})
