export interface TodoCardProps {
  title?: string
  completed?: boolean
  /** Set by the agent when it wants the todo to stand out. */
  highlight?: boolean
  onToggle?: () => void
}

/**
 * The host app's representation of a todo, registered with the chat as the `todoCard` widget.
 * It renders in the app's own React tree with the app's own plain CSS, and the chat only decides
 * where it appears in the conversation and which agent-chosen props it receives.
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
