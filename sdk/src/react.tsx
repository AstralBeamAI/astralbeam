import { type ComponentType, useEffect, useRef, useState } from "react"
// Self-reference rather than a relative path, so this entry shares the client entry's widget
// chunk and its bundled React instead of bundling a second copy.
import { type CustomComponentRenderRequest, mountAstralBeamChat } from "@astralbeam/sdk/client"

export interface CustomComponentEntry {
  /** Rendered in the host's React tree on request; the agent picks props, hence the loose typing. */
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
    // Registered once at mount; changing customComponents afterwards is not supported yet.
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
