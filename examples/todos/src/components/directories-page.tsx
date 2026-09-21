import { Link } from "@tanstack/react-router"
import { useState } from "react"
import {
  type AstralBeamChatColorScheme,
  AstralBeamTenantList,
  AstralBeamTenantUserList,
} from "@astralbeam/sdk/react"
import { APP_NAME, ASTRALBEAM_API_URL, DIRECTORY_TOKEN_SOURCE } from "@/lib/config.ts"
import { COLOR_SCHEME_CYCLE, WIDGET_THEME } from "@/lib/constants.ts"
import { useSystemDark } from "@/hooks/use-system-dark.ts"

export function DirectoriesPage(
  { kind, tenantExternalId }: { kind: "tenants" | "users"; tenantExternalId?: string | undefined },
) {
  const [showAdmin, setShowAdmin] = useState(false)
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null)
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
              <Link to="/tenants">Tenants</Link>
              <Link to="/tenant-users">Tenant users</Link>
            </nav>
            <h1>{kind === "tenants" ? "Tenants" : "Tenant users"}</h1>
          </div>
          <span>{APP_NAME}</span>
        </header>
        <p>
          {kind === "tenants"
            ? "Browse your customers."
            : "Choose a tenant to browse and filter its users."}
        </p>
        <div className="todos-actions">
          <button
            type="button"
            onClick={() =>
              setColorScheme(
                COLOR_SCHEME_CYCLE[
                  (COLOR_SCHEME_CYCLE.indexOf(colorScheme) + 1) % COLOR_SCHEME_CYCLE.length
                ]!,
              )}
          >
            Theme: {colorScheme}
          </button>
          <button type="button" onClick={() => setCustomTheme(!customTheme)}>
            Custom theme: {customTheme ? "on" : "off"}
          </button>
        </div>
        {kind === "users" && (
          <label>
            <input
              type="checkbox"
              checked={showAdmin}
              onChange={(event) => setShowAdmin(event.target.checked)}
            />
            Show stored admin fields
          </label>
        )}
        {kind === "users" && tenantExternalId === undefined && (
          <p role="status">Selected tenant: {selectedTenant ?? "None"}</p>
        )}
        {error && (
          <div role="alert">
            <p>Directory error: {error.message}</p>
            <button type="button" onClick={() => setError(null)}>Dismiss error</button>
          </div>
        )}
        {kind === "tenants"
          ? (
            <AstralBeamTenantList
              apiUrl={ASTRALBEAM_API_URL}
              fetchAstralBeamToken={DIRECTORY_TOKEN_SOURCE}
              scope="organization"
              colorScheme={colorScheme}
              theme={customTheme ? WIDGET_THEME : undefined}
              onError={setError}
            />
          )
          : (
            <AstralBeamTenantUserList
              tenantExternalId={tenantExternalId}
              showAdmin={showAdmin}
              apiUrl={ASTRALBEAM_API_URL}
              fetchAstralBeamToken={{ ...DIRECTORY_TOKEN_SOURCE }}
              scope="organization"
              colorScheme={colorScheme}
              theme={customTheme ? WIDGET_THEME : undefined}
              onError={setError}
              onTenantChange={(tenant) =>
                setSelectedTenant(tenant?.name || tenant?.external_id || null)}
            />
          )}
      </main>
    </div>
  )
}
