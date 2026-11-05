import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { LocalDateTime } from "@/components/local-date-time"
import type { SandboxTestMetadata } from "@/lib/sandboxes/schemas"

export type SandboxConnectionStatusProps = {
  metadata: SandboxTestMetadata
}

export function SandboxConnectionStatus({ metadata }: SandboxConnectionStatusProps) {
  return (
    <Alert variant={metadata.status === "success" ? "default" : "destructive"}>
      <AlertTitle>Connection {metadata.status === "success" ? "verified" : "failed"}</AlertTitle>
      <AlertDescription>
        Last tested <LocalDateTime value={metadata.testedAt} dateStyle="medium" />
        {metadata.errorCode ? ` · ${metadata.errorCode.replaceAll("_", " ")}` : ""}
      </AlertDescription>
    </Alert>
  )
}
