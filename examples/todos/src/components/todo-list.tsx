import type { AstralBeamChatColorScheme } from "@astralbeam/sdk/react"

import type { Todo } from "@/lib/types.ts"

interface TodoListProps {
  chatOpen: boolean
  colorScheme: AstralBeamChatColorScheme
  customTheme: boolean
  debug: boolean
  draft: string
  todos: Todo[]
  onAddTodo: () => void
  onChangeDraft: (draft: string) => void
  onCycleColorScheme: () => void
  onToggleChat: () => void
  onToggleCustomTheme: () => void
  onToggleDebug: () => void
  onToggleTodo: (id: number) => void
}

export function TodoList({
  chatOpen,
  colorScheme,
  customTheme,
  debug,
  draft,
  todos,
  onAddTodo,
  onChangeDraft,
  onCycleColorScheme,
  onToggleChat,
  onToggleCustomTheme,
  onToggleDebug,
  onToggleTodo,
}: TodoListProps) {
  return (
    <main className="todos">
      <header className="todos-header">
        <h1>Todos</h1>
      </header>
      <form
        className="todos-form"
        onSubmit={(event) => {
          event.preventDefault()
          onAddTodo()
        }}
      >
        <input
          value={draft}
          onChange={(event) => onChangeDraft(event.currentTarget.value)}
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
                onChange={() => onToggleTodo(todo.id)}
              />
              <span className={todo.completed ? "todo-done" : ""}>{todo.text}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="todos-actions">
        <button type="button" onClick={onCycleColorScheme}>
          Theme: {colorScheme}
        </button>
        <button type="button" onClick={onToggleCustomTheme}>
          Custom theme: {customTheme ? "on" : "off"}
        </button>
        <button type="button" onClick={onToggleChat}>
          {chatOpen ? "Hide assistant" : "Show assistant"}
        </button>
        <button type="button" onClick={onToggleDebug}>
          Debug: {debug ? "on" : "off"}
        </button>
      </div>
    </main>
  )
}
