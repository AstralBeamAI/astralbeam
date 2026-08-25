import { useRef, useState } from "react"
import type { AstralBeamChatColorScheme, ToolDefinition } from "@astralbeam/sdk/react"

import { TodoList } from "@/components/todo-list.tsx"
import { TodosAssistant } from "@/components/todos-assistant.tsx"
import { toggleDebug, useDebug } from "@/hooks/use-debug.ts"
import { useSystemDark } from "@/hooks/use-system-dark.ts"
import { COLOR_SCHEME_CYCLE, INITIAL_TODOS, TODO_TOOL_METADATA } from "@/lib/constants.ts"
import {
  createTodoFromToolInput,
  deleteTodoFromToolInput,
  updateTodoFromToolInput,
} from "@/lib/todo-tools.ts"

export function TodosPage() {
  const debug = useDebug()
  const systemIsDark = useSystemDark()
  const [todos, setTodos] = useState(INITIAL_TODOS)
  const [draft, setDraft] = useState("")
  const [chatOpen, setChatOpen] = useState(true)
  const [colorScheme, setColorScheme] = useState<AstralBeamChatColorScheme>("system")
  const [customTheme, setCustomTheme] = useState(true)
  const todosRef = useRef(todos)
  todosRef.current = todos
  const nextTodoId = useRef(Math.max(0, ...INITIAL_TODOS.map((todo) => todo.id)) + 1)

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
      ...TODO_TOOL_METADATA.get_todos,
      execute: () => ({ todos: todosRef.current }),
    },
    create_todo: {
      ...TODO_TOOL_METADATA.create_todo,
      execute: (input) => {
        const todo = createTodoFromToolInput({ id: nextTodoId.current++, input })
        setTodos((current) => [...current, todo])
        return { created: todo }
      },
    },
    update_todo: {
      ...TODO_TOOL_METADATA.update_todo,
      execute: (input) => {
        const updated = updateTodoFromToolInput({ input, todos: todosRef.current })
        setTodos((current) =>
          current.map((candidate) => candidate.id === updated.id ? updated : candidate)
        )
        return { updated }
      },
    },
    delete_todo: {
      ...TODO_TOOL_METADATA.delete_todo,
      execute: (input) => {
        const deleted = deleteTodoFromToolInput({ input, todos: todosRef.current })
        setTodos((current) => current.filter((candidate) => candidate.id !== deleted.id))
        return { deleted }
      },
    },
  }

  const dark = colorScheme === "dark" || (colorScheme === "system" && systemIsDark)
  const cycleColorScheme = () =>
    setColorScheme((current) =>
      COLOR_SCHEME_CYCLE[
        (COLOR_SCHEME_CYCLE.indexOf(current) + 1) % COLOR_SCHEME_CYCLE.length
      ]!
    )

  return (
    <div className={dark ? "app dark" : "app"}>
      <TodoList
        chatOpen={chatOpen}
        colorScheme={colorScheme}
        customTheme={customTheme}
        debug={debug}
        draft={draft}
        todos={todos}
        onAddTodo={addTodo}
        onChangeDraft={setDraft}
        onCycleColorScheme={cycleColorScheme}
        onToggleChat={() => setChatOpen((open) => !open)}
        onToggleCustomTheme={() => setCustomTheme((on) => !on)}
        onToggleDebug={toggleDebug}
        onToggleTodo={toggleTodo}
      />
      {chatOpen && (
        <TodosAssistant
          colorScheme={colorScheme}
          customTheme={customTheme}
          debug={debug}
          todos={todos}
          tools={tools}
          onToggleTodo={toggleTodo}
        />
      )}
    </div>
  )
}
