import type { Todo } from "@/lib/types.ts"

export function TodoCard({
  todo,
  highlight = false,
  onToggle,
}: {
  todo: Todo
  highlight?: boolean
  onToggle: () => void
}) {
  return (
    <label className={`todo-card${highlight ? " todo-card-highlight" : ""}`}>
      <input type="checkbox" checked={todo.completed} onChange={onToggle} />
      <span className={todo.completed ? "todo-done" : ""}>{todo.text}</span>
    </label>
  )
}
