export interface TodoCardProps {
  title?: string
  completed?: boolean
  /** Set by the simulated agent when it wants the todo to stand out. */
  highlight?: boolean
  onToggle?: () => void
}

/**
 * The host app's representation of a todo, registered with the chat widget as a custom component.
 * It renders in the app's own React tree with the app's own plain CSS, and the widget only decides
 * where it appears in the conversation.
 */
export function TodoCard({ title, completed = false, highlight = false, onToggle }: TodoCardProps) {
  return (
    <div className={`todo-card${highlight ? " todo-card-highlight" : ""}`}>
      <label className="todo-card-row">
        <input type="checkbox" checked={completed} onChange={() => onToggle?.()} />
        <span className={completed ? "todo-done" : ""}>{title ?? "Untitled todo"}</span>
      </label>
      <div className="todo-card-note">Rendered by the todos app, not the chat widget</div>
    </div>
  )
}
