import { AstralBeamChat, type ToolDefinition } from "@astralbeam/sdk/react"
import { useCallback, useRef, type ComponentProps } from "react"
import { TodoCard } from "@/components/todo-card.tsx"
import { useTodos } from "@/hooks/use-todos.ts"
import { ASTRALBEAM_API_URL, CHAT_AGENT_ID, CHAT_TITLE } from "@/lib/config.ts"

export function TodosAssistant(
  props: Pick<ComponentProps<typeof AstralBeamChat>, "colorScheme" | "theme" | "debug" | "onClose">,
) {
  const { todos, getTodos, createTodo, updateTodo, deleteTodo, toggleTodo } = useTodos()
  const sidebar = useRef<HTMLElement>(null)
  const resizeContainer = useCallback(() => sidebar.current?.parentElement ?? null, [])
  const tools: Record<string, ToolDefinition> = {
    get_todos: {
      metadata: { title: "List the todos" },
      description: "List every todo with its id, text, and completed flag.",
      execute: () => ({ todos: getTodos() }),
    },
    create_todo: {
      metadata: { title: "Create a todo" },
      description: "Create a new todo and append it to the list.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" }, completed: { type: "boolean" } },
        required: ["text"],
      },
      execute: (input) => ({ created: createTodo(input) }),
    },
    update_todo: {
      metadata: { title: "Update a todo" },
      description: "Update a todo's text, completed flag, or both, by its id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" },
          text: { type: "string" },
          completed: { type: "boolean" },
        },
        required: ["id"],
      },
      execute: (input) => ({ updated: updateTodo(input) }),
    },
    delete_todo: {
      metadata: { title: "Delete a todo" },
      description: "Delete a todo by its id.",
      parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
      execute: (input) => ({ deleted: deleteTodo(input) }),
    },
  }

  return (
    <aside ref={sidebar} className="chat-sidebar">
      <AstralBeamChat
        {...props}
        agentId={CHAT_AGENT_ID}
        apiUrl={ASTRALBEAM_API_URL}
        title={CHAT_TITLE}
        resizeContainer={resizeContainer}
        emptyHeadline="What would you like to get done?"
        emptyDescription="Try asking to list your tasks, add a new task, or mark one complete."
        tools={tools}
        widgets={{
          todoCard: {
            description: "A single todo from the host app, addressed by its id",
            parameters: {
              type: "object",
              properties: { id: { type: "number" }, highlight: { type: "boolean" } },
              required: ["id"],
            },
            render: ({ id, highlight }) => {
              const todo = todos.find((entry) => entry.id === Number(id))
              if (!todo) return <p>This todo was deleted.</p>
              return (
                <TodoCard
                  todo={todo}
                  highlight={Boolean(highlight)}
                  onToggle={() => toggleTodo(todo.id)}
                />
              )
            },
          },
        }}
        sandboxPanel
      />
    </aside>
  )
}
