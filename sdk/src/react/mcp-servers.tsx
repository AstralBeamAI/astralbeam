import { useEffect, useRef, type CSSProperties } from "react"
import {
  mountAstralBeamMcpServers,
  type AstralBeamMcpServersHandle,
  type MountAstralBeamMcpServersOptions,
} from "@astralbeam/sdk/client"

export type AstralBeamMcpServersProps = MountAstralBeamMcpServersOptions & {
  className?: string | undefined
  style?: CSSProperties | undefined
}

/** Key by the authenticated identity and management scope to clear pending form values. */
export function AstralBeamMcpServers({
  className,
  style,
  servers,
  oauthRedirectUri,
  onCreateServer,
  onRemoveServer,
  colorScheme,
  theme,
}: AstralBeamMcpServersProps) {
  const options = { servers, oauthRedirectUri, onCreateServer, onRemoveServer, colorScheme, theme }
  const target = useRef<HTMLDivElement>(null)
  const handle = useRef<AstralBeamMcpServersHandle | null>(null)
  const live = useRef(options)
  useEffect(() => {
    live.current = options
    handle.current?.update(options)
  })
  useEffect(() => {
    const mounted = mountAstralBeamMcpServers(target.current!, live.current)
    handle.current = mounted
    return () => {
      handle.current = null
      mounted.unmount()
    }
  }, [])
  return <div ref={target} className={className} style={style} />
}
