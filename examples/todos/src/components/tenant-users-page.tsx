import { useContext, useState } from "react"
import { AstralBeamTenantUserList } from "@astralbeam/sdk/react"
import { ASTRALBEAM_API_URL } from "@/lib/config.ts"
import { WIDGET_THEME } from "@/lib/constants.ts"
import { AppearanceContext } from "@/lib/appearance.ts"
import directoryCss from "./directory.css?inline"

export function UsersPage() {
  const { colorScheme, customTheme } = useContext(AppearanceContext)
  const [showAdmin, setShowAdmin] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  return (
    <section className="page-content">
      {error && (
        <div role="alert" className="directory-error">
          <p>Directory error: {error.message}</p>
          <button type="button" onClick={() => setError(null)}>
            Dismiss error
          </button>
        </div>
      )}
      <AstralBeamTenantUserList
        title="Users"
        showHeader={false}
        customCss={directoryCss}
        showAdmin={showAdmin}
        apiUrl={ASTRALBEAM_API_URL}
        fetchAstralBeamToken={{ url: "/api/astralbeam/token" }}
        colorScheme={colorScheme}
        theme={customTheme ? WIDGET_THEME : undefined}
        onError={setError}
      />
      <label className="admin-toggle">
        <input
          type="checkbox"
          checked={showAdmin}
          onChange={(event) => setShowAdmin(event.target.checked)}
        />
        Show stored admin fields
      </label>
    </section>
  )
}
