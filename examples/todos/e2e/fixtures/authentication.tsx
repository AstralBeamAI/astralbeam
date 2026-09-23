import { StrictMode, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import type { AstralBeamTenantUserListHandle } from "@astralbeam/sdk/client"
import { AstralBeamTenantUserList } from "@astralbeam/sdk/react"
import { ASTRALBEAM_API_URL } from "../../src/lib/config.ts"

function Authentication() {
  const directory = useRef<AstralBeamTenantUserListHandle>(null)
  const [errors, setErrors] = useState(0)
  return (
    <>
      <button type="button" onClick={() => directory.current?.refresh()}>Refresh from host</button>
      <output aria-label="Host errors">{errors}</output>
      <AstralBeamTenantUserList
        ref={directory}
        apiUrl={ASTRALBEAM_API_URL}
        onError={() => setErrors((count) => count + 1)}
        fetchAstralBeamToken={async () => {
          const response = await fetch("/__authentication-token")
          return (await response.json()) as { token: string }
        }}
      />
    </>
  )
}

createRoot(document.getElementById("authentication-root")!).render(
  <StrictMode>
    <Authentication />
  </StrictMode>,
)
