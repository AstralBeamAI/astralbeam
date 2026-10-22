import { StrictMode, useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { AstralBeamTenantUserList, type AstralBeamTenantUserListRef } from "@astralbeam/sdk/react"
import { ASTRALBEAM_API_URL } from "../../src/lib/config.ts"

function Authentication() {
  const directory = useRef<AstralBeamTenantUserListRef>(null)
  const [errors, setErrors] = useState(0)
  const [completion, setCompletion] = useState("pending")
  useLayoutEffect(() => {
    let mounted = true
    void directory.current!.refresh().then(
      () => {
        if (mounted) setCompletion("fulfilled")
      },
      (error: Error) => {
        if (mounted) setCompletion(error.name)
      },
    )
    return () => {
      mounted = false
    }
  }, [])
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCompletion("pending")
          void directory.current!.refresh().then(
            () => setCompletion("fulfilled"),
            (error: Error) => setCompletion(error.name),
          )
        }}
      >
        Refresh from host
      </button>
      <output aria-label="Host errors">{errors}</output>
      <output aria-label="Host refresh">{completion}</output>
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
