import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { useState } from "react"
import type { AstralBeamChatColorScheme } from "@astralbeam/sdk/react"

import { TodosAssistant } from "@/components/todos-assistant.tsx"
import { AppearanceContext } from "@/lib/appearance.ts"
import { toggleDebug, useDebug } from "@/hooks/use-debug.ts"
import { useSystemDark } from "@/hooks/use-system-dark.ts"
import { APP_NAME } from "@/lib/config.ts"
import { COLOR_SCHEME_CYCLE } from "@/lib/constants.ts"

const pages = [
  { path: "/", title: "Todos", description: "Browse, search and manage your todos." },
  {
    path: "/tenant-users",
    title: "Users",
    description: "Browse and filter the users in your tenant.",
  },
] as const

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const page = pages.find(({ path }) => pathname === path || pathname === `${path}/`) ?? pages[0]
  const debug = useDebug()
  const systemDark = useSystemDark()
  const [chatOpen, setChatOpen] = useState(true)
  const [colorScheme, setColorScheme] = useState<AstralBeamChatColorScheme>("system")
  const [customTheme, setCustomTheme] = useState(true)
  const dark = colorScheme === "dark" || (colorScheme === "system" && systemDark)
  return (
    <AppearanceContext value={{ colorScheme, customTheme }}>
      <div className={`app${dark ? " dark" : ""}${chatOpen ? "" : " assistant-hidden"}`}>
        <main className="todos">
          <header className="todos-header">
            <nav aria-label="Example pages">
              {pages.map(({ path, title }) => (
                <Link
                  key={path}
                  to={path}
                  activeOptions={{ exact: true }}
                  activeProps={{ className: "active", "aria-current": "page" }}
                >
                  {title}
                </Link>
              ))}
            </nav>
            <span className="app-name">{APP_NAME}</span>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
          </header>
          <div className="todos-actions">
            <button
              type="button"
              onClick={() =>
                setColorScheme(
                  (current) =>
                    COLOR_SCHEME_CYCLE[
                      (COLOR_SCHEME_CYCLE.indexOf(current) + 1) % COLOR_SCHEME_CYCLE.length
                    ]!,
                )
              }
            >
              Theme: {colorScheme}
            </button>
            <button type="button" onClick={() => setCustomTheme((on) => !on)}>
              Custom theme: {customTheme ? "on" : "off"}
            </button>
            <button type="button" onClick={() => setChatOpen((open) => !open)}>
              {chatOpen ? "Hide assistant" : "Show assistant"}
            </button>
            <button type="button" onClick={toggleDebug}>
              Debug: {debug ? "on" : "off"}
            </button>
          </div>
          <Outlet />
        </main>
        {chatOpen && (
          <TodosAssistant colorScheme={colorScheme} customTheme={customTheme} debug={debug} />
        )}
      </div>
    </AppearanceContext>
  )
}
