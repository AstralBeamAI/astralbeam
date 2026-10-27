import { useContext, useState } from "react"
import { AstralBeamThreadList } from "@astralbeam/sdk/react"
import { ASTRALBEAM_API_URL } from "@/lib/config.ts"
import { WIDGET_THEME } from "@/lib/constants.ts"
import { AppearanceContext } from "@/lib/appearance.ts"
import directoryCss from "./directory.css?inline"

export function ConversationsPage() {
  const { colorScheme, customTheme } = useContext(AppearanceContext)
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
      <AstralBeamThreadList
        title="Conversations"
        showHeader={false}
        customCss={directoryCss}
        apiUrl={ASTRALBEAM_API_URL}
        fetchAstralBeamToken={{ url: "/api/astralbeam/token" }}
        colorScheme={colorScheme}
        theme={customTheme ? WIDGET_THEME : undefined}
        onError={setError}
      />
    </section>
  )
}
