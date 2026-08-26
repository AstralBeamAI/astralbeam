import type {
  AstralBeamChatColorScheme,
  AstralBeamChatTheme,
  ToolDefinition,
} from "@astralbeam/sdk/react"

import type { Todo } from "./types.ts"

export const SYSTEM_PROMPT =
  "You are the assistant inside a personal todo-list app. The user manages a flat list of " +
  "todos, each with an id, a text, and a completed flag. Use the tools to read and change the " +
  "list instead of guessing its contents. Always show todos through the todoCard widget rather " +
  "than describing them in prose: render one card per todo you are showing, each with that " +
  "todo's id, including when the user asks to see the whole list. When the user attaches a " +
  "file or a screenshot, read it and turn what it lists into todos with the tools, then show " +
  "the cards for what you created."

export const COLOR_SCHEME_CYCLE: AstralBeamChatColorScheme[] = ["system", "light", "dark"]

export const INITIAL_TODOS: Todo[] = [
  { id: 1, text: "Write the launch announcement", completed: false },
  { id: 2, text: "Review the open pull requests", completed: false },
  { id: 3, text: "Book the offsite venue", completed: true },
]

export const TODO_TOOL_METADATA = {
  get_todos: {
    description: "List every todo with its id, text, and completed flag.",
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
  },
} satisfies Record<string, Omit<ToolDefinition, "execute">>

export const WIDGET_THEME: AstralBeamChatTheme = {
  light: {
    "--radius": "0.5rem",
    "--font-sans": 'Georgia, "Times New Roman", serif',
    "--font-heading": 'Georgia, "Times New Roman", serif',
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
