import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { SandboxTestMetadata } from "@/lib/sandbox/schemas"

export type SandboxConnectionStatusProps = {
  metadata: SandboxTestMetadata
}

export function SandboxConnectionStatus({ metadata }: SandboxConnectionStatusProps) {
  const testedAt = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(metadata.testedAt))

  return (
    <Alert variant={metadata.status === "success" ? "default" : "destructive"}>
      <AlertTitle>Connection {metadata.status === "success" ? "verified" : "failed"}</AlertTitle>
      <AlertDescription>
        Last tested <time dateTime={metadata.testedAt}>{testedAt}</time>
        {metadata.errorCode ? ` · ${metadata.errorCode.replaceAll("_", " ")}` : ""}
      </AlertDescription>
    </Alert>
  )
}
