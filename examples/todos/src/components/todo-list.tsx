import type { Todo } from "@/lib/types.ts"
import { TodoCard } from "@/components/todo-card.tsx"

interface TodoListProps {
  draft: string
  search: string
  todos: Todo[]
  onAddTodo: () => void
  onChangeDraft: (draft: string) => void
  onSearch: (search: string) => void
  onToggleTodo: (id: number) => void
  onDeleteTodo: (id: number) => void
}

export function TodoList({
  draft,
  search,
  todos,
  onAddTodo,
  onChangeDraft,
  onSearch,
  onToggleTodo,
  onDeleteTodo,
}: TodoListProps) {
  return (
    <section className="page-content">
      <div className="listing-toolbar">
        <input
          type="search"
          aria-label="Search todos"
          placeholder="Search todos…"
          value={search}
          onChange={(event) => onSearch(event.currentTarget.value)}
        />
      </div>
      <div className="listing-table">
        <table className="todos-list">
          <thead>
            <tr>
              <th>Todo</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {todos.map((todo) => (
              <tr key={todo.id}>
                <td>
                  <TodoCard todo={todo} onToggle={() => onToggleTodo(todo.id)} />
                </td>
                <td>
                  <span className="todo-status">{todo.completed ? "Completed" : "Pending"}</span>
                  <button
                    type="button"
                    aria-label={`Delete ${todo.text}`}
                    title="Delete todo"
                    onClick={() => onDeleteTodo(todo.id)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {!todos.length && (
              <tr>
                <td colSpan={2} className="listing-empty">
                  No todos match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
    </section>
  )
}
