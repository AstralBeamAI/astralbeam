import type { AstralBeamChatTheme } from "@astralbeam/sdk/react"

import type { Todo } from "./types.ts"

export const COLOR_SCHEME_CYCLE = ["system", "light", "dark"] as const

export const INITIAL_TODOS: Todo[] = [
  { id: 1, text: "Write the launch announcement", completed: false },
  { id: 2, text: "Review the open pull requests", completed: false },
  { id: 3, text: "Book the offsite venue", completed: true },
]

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
