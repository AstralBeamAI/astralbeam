import { Outlet } from "@tanstack/react-router"
import { useState } from "react"
import { useSystemDark } from "@/hooks/use-system-dark.ts"
import { APP_NAME } from "@/lib/config.ts"
import { COLOR_SCHEME_CYCLE } from "@/lib/constants.ts"

export function AppShell() {
  const systemDark = useSystemDark()
  const [colorScheme, setColorScheme] = useState<(typeof COLOR_SCHEME_CYCLE)[number]>("system")
  const dark = colorScheme === "dark" || (colorScheme === "system" && systemDark)
  return (
    <div className={dark ? "app dark" : "app"}>
      <main className="todos">
        <header className="todos-header">
          <h1>{APP_NAME}</h1>
          <p>Browse, search and manage your todos.</p>
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
        </div>
        <Outlet />
      </main>
    </div>
  )
}
