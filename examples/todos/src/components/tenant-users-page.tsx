import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { type AstralBeamChatColorScheme, AstralBeamTenantUserList } from "@astralbeam/sdk/react"
import { APP_NAME, ASTRALBEAM_API_URL } from "@/lib/config.ts"
import { COLOR_SCHEME_CYCLE, WIDGET_THEME } from "@/lib/constants.ts"
import { useSystemDark } from "@/hooks/use-system-dark.ts"

export function TenantUsersPage() {
  const [showAdmin, setShowAdmin] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [colorScheme, setColorScheme] = useState<AstralBeamChatColorScheme>("system")
  const [customTheme, setCustomTheme] = useState(true)
  const systemDark = useSystemDark()
  const dark = colorScheme === "dark" || (colorScheme === "system" && systemDark)
  return (
    <div className={`app${dark ? " dark" : ""}`}>
      <main className="todos directories">
        <header className="todos-header">
          <div>
            <nav aria-label="Example pages">
              <Link to="/">Todos</Link>
              <Link to="/tenant-users">Tenant users</Link>
            </nav>
            <h1>Tenant users</h1>
          </div>
          <span>{APP_NAME}</span>
        </header>
        <p>Browse and filter the users in your tenant.</p>
        <div className="todos-actions">
          <button
            type="button"
            onClick={() =>
              setColorScheme(
                COLOR_SCHEME_CYCLE[
                  (COLOR_SCHEME_CYCLE.indexOf(colorScheme) + 1) % COLOR_SCHEME_CYCLE.length
                ]!,
              )
            }
          >
            Theme: {colorScheme}
          </button>
          <button type="button" onClick={() => setCustomTheme(!customTheme)}>
            Custom theme: {customTheme ? "on" : "off"}
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={showAdmin}
            onChange={(event) => setShowAdmin(event.target.checked)}
          />
          Show stored admin fields
        </label>
        {error && (
          <div role="alert">
            <p>Directory error: {error.message}</p>
            <button type="button" onClick={() => setError(null)}>
              Dismiss error
            </button>
          </div>
        )}
        <AstralBeamTenantUserList
          showAdmin={showAdmin}
          apiUrl={ASTRALBEAM_API_URL}
          fetchAstralBeamToken={{ url: "/api/astralbeam/token" }}
          colorScheme={colorScheme}
          theme={customTheme ? WIDGET_THEME : undefined}
          onError={setError}
        />
      </main>
    </div>
  )
}
