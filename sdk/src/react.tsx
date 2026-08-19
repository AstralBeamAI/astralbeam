import { type ReactNode, useEffect, useRef } from "react"
// The package self-reference (resolved through the exports field) makes the built react entry
// load the client entry's self-contained widget chunk, so the widget always runs on its own
// bundled React regardless of the host app's React version:
// https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

export interface AstralBeamChatProps {
  /** Projected into the widget's `<slot>`, so host apps can render their own UI inside it. */
  children?: ReactNode
}

export function AstralBeamChat({ children }: AstralBeamChatProps) {
  const targetRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!targetRef.current) return
    const handle = mountAstralBeamChat(targetRef.current)
    return handle.unmount
  }, [])
  return <div style={{ height: "100%" }} ref={targetRef}>{children}</div>
}
