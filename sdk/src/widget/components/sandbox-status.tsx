import { WarningCircleIcon } from "@phosphor-icons/react"
import { Marker, MarkerContent, MarkerIcon } from "@/widget/components/ui/marker"
import { Spinner } from "@/widget/components/ui/spinner"
import type { SandboxStatus as SandboxStatusValue } from "../../core/types.ts"

/**
 * Slim provisioning pill above the composer. Starting a sandbox takes tens of seconds with no
 * tool result to show for it, so this is the only feedback; it disappears once the sandbox is
 * ready, because from then on every step is a transcript row.
 */
export function SandboxStatusPill({ status }: { status: SandboxStatusValue }) {
  if (status === "ready") return null
  const starting = status === "starting"
  return (
    <Marker role="status" className="w-full rounded-full border bg-muted/50 px-3 py-1.5">
      <MarkerIcon>{starting ? <Spinner /> : <WarningCircleIcon />}</MarkerIcon>
      <MarkerContent className={starting ? "shimmer" : undefined}>
        {starting ? "Starting the sandbox…" : "The sandbox could not be started"}
      </MarkerContent>
    </Marker>
  )
}
