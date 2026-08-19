import { type ComponentType, useEffect, useRef, useState } from "react"
// The package self-reference (resolved through the exports field) makes the built react entry
// load the client entry's self-contained widget chunk, so the widget always runs on its own
// bundled React regardless of the host app's React version:
// https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name
import { type CustomComponentRenderRequest, mountAstralBeamChat } from "@astralbeam/sdk/client"

export interface CustomComponentEntry {
  /** Rendered by the host app's React tree whenever the widget requests it, so hooks, state, and
   * context work as usual. The widget's agent chooses per-render props, hence the loose typing. */
  // deno-lint-ignore no-explicit-any
  component: ComponentType<any>
  /** Base props for every render, merged under the props chosen per render request. */
  props?: Record<string, unknown>
  /** Tells the agent what the component does so it can decide when to render it. */
  description: string
}

export interface AstralBeamChatProps {
  customComponents?: CustomComponentEntry[]
}

export function AstralBeamChat({ customComponents = [] }: AstralBeamChatProps) {
  const targetRef = useRef<HTMLDivElement>(null)
  const [renderRequests, setRenderRequests] = useState<CustomComponentRenderRequest[]>([])
  useEffect(() => {
    if (!targetRef.current) return
    // Component descriptions are registered once at mount; changing customComponents afterwards
    // is not supported yet.
    const handle = mountAstralBeamChat(targetRef.current, {
      customComponents: customComponents.map(({ description }) => ({ description })),
      // A slot holds at most one active render, so a repeated request replaces the previous one.
      onRenderCustomComponent: (request) =>
        setRenderRequests((previous) => [
          ...previous.filter((existing) => existing.slotName !== request.slotName),
          request,
        ]),
    })
    return handle.unmount
  }, [])
  return (
    <div style={{ height: "100%" }} ref={targetRef}>
      {renderRequests.map((request) => {
        const entry = customComponents[request.componentIndex]
        if (!entry) return null
        return (
          <div key={request.slotName} slot={request.slotName}>
            <entry.component {...entry.props} {...request.props} />
          </div>
        )
      })}
    </div>
  )
}
