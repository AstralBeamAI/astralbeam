import { useRef, useState, useSyncExternalStore } from "react"
import {
  AstralBeamChat,
  type AstralBeamChatColorScheme,
  type AstralBeamChatTheme,
  type ToolDefinition,
} from "@astralbeam/sdk/react"
import { TodoCard } from "./todo-card.tsx"

// The example talks straight to the locally running webapp's agent endpoint.
const CHAT_ENDPOINT = "http://localhost:3000/api/chat"

// Open the app with `?debug` to watch the SDK and the endpoint log the conversation. The
// widget reads the flag once per mount, so the header toggle reloads with `?debug` flipped.
const DEBUG = new URLSearchParams(location.search).has("debug")

const toggleDebug = () => {
  const params = new URLSearchParams(location.search)
  if (DEBUG) params.delete("debug")
  else params.set("debug", "")
  location.search = params.toString()
}

const SYSTEM_PROMPT =
  "You are the assistant inside a personal todo-list app. The user manages a flat list of " +
  "todos, each with an id, a text, and a completed flag. Use the tools to read and change the " +
  "list instead of guessing its contents. Always show todos through the todoCard widget rather " +
  "than describing them in prose: render one card per todo you are showing, each with that " +
  "todo's id, including when the user asks to see the whole list."

const colorSchemeCycle: AstralBeamChatColorScheme[] = ["system", "light", "dark"]

// Overrides every core shadcn token with the app's parchment palette (see styles.css), so the
// "Custom theme" toggle is stark; `light` is the base for both schemes, so `--radius` carries over.
const WIDGET_THEME: AstralBeamChatTheme = {
  light: {
    "--radius": "0.5rem",
    "--background": "#faf6ef",
    "--foreground": "#3d2f1e",
    "--card": "#fdf9f0",
    "--card-foreground": "#3d2f1e",
    "--popover": "#fdf9f0",
    "--popover-foreground": "#3d2f1e",
    "--primary": "#b4762a",
    "--primary-foreground": "#ffffff",
    "--secondary": "#f3e8d3",
    "--secondary-foreground": "#3d2f1e",
    "--muted": "#f3e8d3",
    "--muted-foreground": "#8a7355",
    "--accent": "#e9d9bb",
    "--accent-foreground": "#3d2f1e",
    "--destructive": "#a03c2e",
    "--border": "#c9b892",
    "--input": "#c9b892",
    "--ring": "#b4762a",
  },
  dark: {
    "--background": "#201a11",
    "--foreground": "#ede3cf",
    "--card": "#2b2416",
    "--card-foreground": "#ede3cf",
    "--popover": "#2b2416",
    "--popover-foreground": "#ede3cf",
    "--primary": "#d99a45",
    "--primary-foreground": "#201a11",
    "--secondary": "#3a3020",
    "--secondary-foreground": "#ede3cf",
    "--muted": "#3a3020",
    "--muted-foreground": "#b3a184",
    "--accent": "#4a3d28",
    "--accent-foreground": "#ede3cf",
    "--destructive": "#e2694e",
    "--border": "#6b5a3e",
    "--input": "#6b5a3e",
    "--ring": "#d99a45",
  },
}

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
  const [colorScheme, setColorScheme] = useState<AstralBeamChatColorScheme>("system")
  const [customTheme, setCustomTheme] = useState(true)
  // Agent tools run outside React's render cycle, so they read the list through a live ref.
  const todosRef = useRef(todos)
  todosRef.current = todos
  // A counter rather than Date.now(): the agent can add several todos in one batch of parallel
  // tool calls, which would mint the same millisecond id twice.
  const nextTodoId = useRef(Math.max(0, ...initialTodos.map((todo) => todo.id)) + 1)

  const toggleTodo = (id: number) =>
    setTodos((current) =>
      current.map((todo) => todo.id === id ? { ...todo, completed: !todo.completed } : todo)
    )

  const addTodo = () => {
    const text = draft.trim()
    if (!text) return
    setTodos((current) => [...current, { id: nextTodoId.current++, text, completed: false }])
    setDraft("")
  }

  const tools: Record<string, ToolDefinition> = {
    get_todos: {
      description: "List every todo with its id, text, and completed flag.",
      execute: () => ({ todos: todosRef.current }),
    },
    create_todo: {
      description: "Create a new todo and append it to the list.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What needs to be done" },
          completed: {
            type: "boolean",
            description: "Whether it starts out done. Defaults to false.",
          },
        },
        required: ["text"],
      },
      execute: (input) => {
        const text = String(input.text ?? "").trim()
        if (!text) throw new Error("A todo needs a non-empty text")
        const todo: Todo = { id: nextTodoId.current++, text, completed: input.completed === true }
        setTodos((current) => [...current, todo])
        return { created: todo }
      },
    },
    update_todo: {
      description: "Update a todo's text, its completed flag, or both, by its id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Id of the todo to update" },
          text: { type: "string", description: "Replacement text; omit to keep the current one" },
          completed: {
            type: "boolean",
            description: "New completed state; omit to keep the current one",
          },
        },
        required: ["id"],
      },
      execute: (input) => {
        const id = Number(input.id)
        const todo = todosRef.current.find((candidate) => candidate.id === id)
        if (!todo) throw new Error(`No todo with id ${id}`)
        // An omitted field keeps its current value, and the agent sends "omitted" as either a
        // missing key or an explicit null, so both must be treated the same: coercing null would
        // rename the todo to the string "null" or silently reopen a completed one.
        const text = input.text == null ? todo.text : String(input.text).trim()
        if (!text) throw new Error("A todo needs a non-empty text")
        const updated: Todo = {
          ...todo,
          text,
          completed: input.completed == null ? todo.completed : Boolean(input.completed),
        }
        setTodos((current) => current.map((candidate) => candidate.id === id ? updated : candidate))
        return { updated }
      },
    },
    delete_todo: {
      description: "Delete a todo from the list by its id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Id of the todo to delete" },
        },
        required: ["id"],
      },
      execute: (input) => {
        const id = Number(input.id)
        const todo = todosRef.current.find((candidate) => candidate.id === id)
        if (!todo) throw new Error(`No todo with id ${id}`)
        setTodos((current) => current.filter((candidate) => candidate.id !== id))
        return { deleted: todo }
      },
    },
  }

  const systemIsDark = useSystemDark()
  const dark = colorScheme === "dark" || (colorScheme === "system" && systemIsDark)

  return (
    <div className={dark ? "app dark" : "app"}>
      <main className="todos">
        <header className="todos-header">
          <h1>Todos</h1>
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
        <div className="todos-actions">
          {
            /* One preference themes both sides: the app through its own `.dark` CSS, and the
              widget through the `colorScheme` prop — each resolves "system" on its own. */
          }
          <button
            type="button"
            onClick={() =>
              setColorScheme((current) =>
                colorSchemeCycle[
                  (colorSchemeCycle.indexOf(current) + 1) % colorSchemeCycle.length
                ]!
              )}
          >
            Theme: {colorScheme}
          </button>
          <button type="button" onClick={() => setCustomTheme((on) => !on)}>
            Custom theme: {customTheme ? "on" : "off"}
          </button>
          <button type="button" onClick={() => setChatOpen((open) => !open)}>
            {chatOpen ? "Hide assistant" : "Show assistant"}
          </button>
          <button type="button" onClick={toggleDebug}>
            Debug: {DEBUG ? "on" : "off"}
          </button>
        </div>
      </main>
      {chatOpen && (
        <aside className="chat-sidebar">
          <AstralBeamChat
            title="Todos assistant"
            endpoint={CHAT_ENDPOINT}
            systemPrompt={SYSTEM_PROMPT}
            tools={tools}
            colorScheme={colorScheme}
            theme={customTheme ? WIDGET_THEME : undefined}
            debug={DEBUG}
            widgets={{
              todoCard: {
                description: "A single todo from the host app, addressed by its id",
                parameters: {
                  type: "object",
                  properties: {
                    id: { type: "number", description: "Id of the todo to render" },
                    highlight: {
                      type: "boolean",
                      description: "Make the todo stand out in the conversation",
                    },
                  },
                  required: ["id"],
                },
                // Reads `todos` rather than the ref: the wrapper re-runs this on every app
                // render, so toggling the todo in the list updates the copy in the conversation.
                render: ({ id, highlight }) => {
                  const todo = todos.find((candidate) => candidate.id === Number(id))
                  return todo && (
                    <TodoCard
                      title={todo.text}
                      completed={todo.completed}
                      highlight={Boolean(highlight)}
                      onToggle={() => toggleTodo(todo.id)}
                    />
                  )
                },
              },
            }}
          />
        </aside>
      )}
    </div>
  )
}
