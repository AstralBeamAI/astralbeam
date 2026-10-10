import {
  AstralBeamChat,
  type AstralBeamChatColorScheme,
  type ToolRegistry,
} from "@astralbeam/sdk/react"

import { TodoCard } from "@/components/todo-card.tsx"
import { ASTRALBEAM_API_URL, CHAT_AGENT_ID, CHAT_TITLE } from "@/lib/config.ts"
import { TODO_TOOL_METADATA, WIDGET_THEME } from "@/lib/constants.ts"
import { useTodos } from "@/hooks/use-todos.ts"
import { deleteTodoFromToolInput, updateTodoFromToolInput } from "@/lib/todo-tools.ts"

interface TodosAssistantProps {
  colorScheme: AstralBeamChatColorScheme
  customTheme: boolean
  debug: boolean
}

export function TodosAssistant({ colorScheme, customTheme, debug }: TodosAssistantProps) {
  const { todos, getTodos, setTodos, createTodo } = useTodos()
  const tools: ToolRegistry = {
    get_todos: {
      ...TODO_TOOL_METADATA.get_todos,
      execute: () => ({ todos: getTodos() }),
    },
    create_todo: {
      ...TODO_TOOL_METADATA.create_todo,
      execute: (input) => ({ created: createTodo(input) }),
    },
    update_todo: {
      ...TODO_TOOL_METADATA.update_todo,
      execute: (input) => {
        const updated = updateTodoFromToolInput({ input, todos: getTodos() })
        setTodos((current) =>
          current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
        )
        return { updated }
      },
    },
    delete_todo: {
      ...TODO_TOOL_METADATA.delete_todo,
      execute: (input) => {
        const deleted = deleteTodoFromToolInput({ input, todos: getTodos() })
        setTodos((current) => current.filter((candidate) => candidate.id !== deleted.id))
        return { deleted }
      },
    },
  }

  return (
    <aside className="chat-sidebar">
      <AstralBeamChat
        agentId={CHAT_AGENT_ID}
        title={CHAT_TITLE}
        apiUrl={ASTRALBEAM_API_URL}
        tools={tools}
        colorScheme={colorScheme}
        theme={customTheme ? WIDGET_THEME : undefined}
        sandboxPanel
        debug={debug}
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
            render: ({ id, highlight }, { callTool }) => {
              // Host state changes re-render this definition, keeping projected cards live.
              const todo = todos.find((candidate) => candidate.id === Number(id))
              return (
                todo && (
                  <TodoCard
                    title={todo.text}
                    completed={todo.completed}
                    highlight={Boolean(highlight)}
                    onToggle={() =>
                      void callTool("update_todo", { id: todo.id, completed: !todo.completed })
                    }
                  />
                )
              )
            },
          },
        }}
      />
    </aside>
  )
}
