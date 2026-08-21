import { useState } from "react"
import { AstralBeamChat } from "@astralbeam/sdk/react"
import { TodoCard } from "./todo-card.tsx"

interface Todo {
  id: number
  text: string
  completed: boolean
}

const initialTodos: Todo[] = [
  { id: 1, text: "Write the launch announcement", completed: false },
  { id: 2, text: "Review the open pull requests", completed: false },
  { id: 3, text: "Book the offsite venue", completed: true },
]

export function App() {
  const [todos, setTodos] = useState(initialTodos)
  const [draft, setDraft] = useState("")
  const [chatOpen, setChatOpen] = useState(true)

  const toggleTodo = (id: number) =>
    setTodos((current) =>
      current.map((todo) => todo.id === id ? { ...todo, completed: !todo.completed } : todo)
    )

  const addTodo = () => {
    const text = draft.trim()
    if (!text) return
    setTodos((current) => [...current, { id: Date.now(), text, completed: false }])
    setDraft("")
  }

  // The chat's "top todo" tracks live app state: toggling it in the list updates the chat copy.
  const topTodo = todos.find((todo) => !todo.completed) ?? todos[0]

  return (
    <div className="app">
      <main className="todos">
        <header className="todos-header">
          <h1>Todos</h1>
          <button type="button" onClick={() => setChatOpen((open) => !open)}>
            {chatOpen ? "Hide assistant" : "Show assistant"}
          </button>
        </header>
        <form
          className="todos-form"
          onSubmit={(event) => {
            event.preventDefault()
            addTodo()
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Add a todo…"
            aria-label="New todo"
          />
          <button type="submit">Add</button>
        </form>
        <ul className="todos-list">
          {todos.map((todo) => (
            <li key={todo.id}>
              <label>
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                />
                <span className={todo.completed ? "todo-done" : ""}>{todo.text}</span>
              </label>
            </li>
          ))}
        </ul>
      </main>
      {chatOpen && (
        <aside className="chat-sidebar">
          <AstralBeamChat
            customComponents={[
              {
                component: TodoCard,
                description: "The most important todo from the host app",
                props: topTodo
                  ? {
                    title: topTodo.text,
                    completed: topTodo.completed,
                    onToggle: () => toggleTodo(topTodo.id),
                  }
                  : {},
              },
            ]}
          />
        </aside>
      )}
    </div>
  )
}
