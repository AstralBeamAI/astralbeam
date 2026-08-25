import {
  AstralBeamChat,
  type AstralBeamChatColorScheme,
  type ToolDefinition,
} from "@astralbeam/sdk/react"

import { TodoCard } from "@/components/todo-card.tsx"
import { CHAT_AUTH_ENDPOINT, CHAT_ENDPOINT, CHAT_TITLE } from "@/lib/config.ts"
import { SYSTEM_PROMPT, WIDGET_THEME } from "@/lib/constants.ts"
import type { Todo } from "@/lib/types.ts"

interface TodosAssistantProps {
  colorScheme: AstralBeamChatColorScheme
  customTheme: boolean
  debug: boolean
  todos: Todo[]
  tools: Record<string, ToolDefinition>
  onToggleTodo: (id: number) => void
}

export function TodosAssistant({
  colorScheme,
  customTheme,
  debug,
  todos,
  tools,
  onToggleTodo,
}: TodosAssistantProps) {
  return (
    <aside className="chat-sidebar">
      <AstralBeamChat
        title={CHAT_TITLE}
        chatEndpoint={CHAT_ENDPOINT}
        authEndpoint={CHAT_AUTH_ENDPOINT}
        systemPrompt={SYSTEM_PROMPT}
        tools={tools}
        colorScheme={colorScheme}
        theme={customTheme ? WIDGET_THEME : undefined}
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
            render: ({ id, highlight }) => {
              // Host state changes re-render this definition, keeping projected cards live.
              const todo = todos.find((candidate) => candidate.id === Number(id))
              return todo && (
                <TodoCard
                  title={todo.text}
                  completed={todo.completed}
                  highlight={Boolean(highlight)}
                  onToggle={() => onToggleTodo(todo.id)}
                />
              )
            },
          },
        }}
      />
    </aside>
  )
}
