import { useRef, useState, useSyncExternalStore } from "react"
import {
  AstralBeamChat,
  type AstralBeamChatTheme,
  type ToolDefinition,
} from "@astralbeam/sdk/react"
import { TodoCard } from "./todo-card.tsx"

// The example talks straight to the locally running webapp's agent endpoint.
const CHAT_ENDPOINT = "http://localhost:3000/api/chat"

const SYSTEM_PROMPT =
  "You are the assistant inside a personal todo-list app. The user manages a flat list of " +
  "todos, each with an id, a text, and a completed flag. Use the tools to read and change the " +
  "list instead of guessing its contents, and render the todoCard widget when the conversation " +
  "focuses on the most important (first uncompleted) todo."

const themeCycle: AstralBeamChatTheme[] = ["system", "light", "dark"]

// The app resolves "system" for its own styling; the widget resolves it independently inside.
const systemDark = matchMedia("(prefers-color-scheme: dark)")
const useSystemDark = () =>
  useSyncExternalStore((onChange) => {
    systemDark.addEventListener("change", onChange)
    return () => systemDark.removeEventListener("change", onChange)
  }, () => systemDark.matches)

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
  const [theme, setTheme] = useState<AstralBeamChatTheme>("system")
  // Agent tools run outside React's render cycle, so they read the list through a live ref.
  const todosRef = useRef(todos)
  todosRef.current = todos

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

  const tools: Record<string, ToolDefinition> = {
    list_todos: {
      description: "List every todo with its id, text, and completed flag.",
      execute: () => ({ todos: todosRef.current }),
    },
    add_todo: {
      description: "Add a new todo to the list.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What needs to be done" },
        },
        required: ["text"],
      },
      execute: (input) => {
        const text = String(input.text ?? "").trim()
        if (!text) throw new Error("A todo needs a non-empty text")
        const todo: Todo = { id: Date.now(), text, completed: false }
        setTodos((current) => [...current, todo])
        return { added: todo }
      },
    },
    set_todo_completed: {
      description: "Mark a todo as completed or uncompleted by its id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Id of the todo to update" },
          completed: { type: "boolean", description: "New completed state" },
        },
        required: ["id", "completed"],
      },
      execute: (input) => {
        const id = Number(input.id)
        const todo = todosRef.current.find((candidate) => candidate.id === id)
        if (!todo) throw new Error(`No todo with id ${id}`)
        const updated: Todo = { ...todo, completed: Boolean(input.completed) }
        setTodos((current) => current.map((candidate) => candidate.id === id ? updated : candidate))
        return { updated }
      },
    },
  }

  // The chat's "top todo" tracks live app state: toggling it in the list updates the chat copy.
  const topTodo = todos.find((todo) => !todo.completed) ?? todos[0]
  const systemIsDark = useSystemDark()
  const dark = theme === "dark" || (theme === "system" && systemIsDark)

  return (
    <div className={dark ? "app dark" : "app"}>
      <main className="todos">
        <header className="todos-header">
          <h1>Todos</h1>
          <div className="todos-header-actions">
            {
              /* One preference themes both sides: the app through its own `.dark` CSS, and the
                widget through the `theme` prop — each resolves "system" on its own. */
            }
            <button
              type="button"
              onClick={() =>
                setTheme((current) =>
                  themeCycle[(themeCycle.indexOf(current) + 1) % themeCycle.length]!
                )}
            >
              Theme: {theme}
            </button>
            <button type="button" onClick={() => setChatOpen((open) => !open)}>
              {chatOpen ? "Hide assistant" : "Show assistant"}
            </button>
          </div>
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
            endpoint={CHAT_ENDPOINT}
            systemPrompt={SYSTEM_PROMPT}
            tools={tools}
            theme={theme}
            widgets={{
              todoCard: {
                description: "The most important todo from the host app",
                parameters: {
                  type: "object",
                  properties: {
                    highlight: {
                      type: "boolean",
                      description: "Make the todo stand out in the conversation",
                    },
                  },
                },
                render: ({ highlight }) =>
                  topTodo && (
                    <TodoCard
                      title={topTodo.text}
                      completed={topTodo.completed}
                      highlight={Boolean(highlight)}
                      onToggle={() => toggleTodo(topTodo.id)}
                    />
                  ),
              },
            }}
          />
        </aside>
      )}
    </div>
  )
}
