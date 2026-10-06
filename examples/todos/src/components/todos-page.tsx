import { useState } from "react"
import { TodoList } from "@/components/todo-list.tsx"
import { useTodos } from "@/hooks/use-todos.ts"

export function TodosPage() {
  const { todos, setTodos, createTodo } = useTodos()
  const [draft, setDraft] = useState("")
  const [search, setSearch] = useState("")
  const toggleTodo = (id: number) =>
    setTodos((current) =>
      current.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
    )
  const addTodo = () => {
    const text = draft.trim()
    if (!text) return
    createTodo({ text })
    setDraft("")
  }
  return (
    <TodoList
      draft={draft}
      search={search}
      todos={todos.filter((todo) => todo.text.toLowerCase().includes(search.trim().toLowerCase()))}
      onAddTodo={addTodo}
      onChangeDraft={setDraft}
      onSearch={setSearch}
      onToggleTodo={toggleTodo}
    />
  )
}
