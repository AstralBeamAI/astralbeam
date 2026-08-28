import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ConfigIssue } from "@/lib/types"

export function SetupStatusAlert({
  setupComplete,
  issues,
  fallbackEncryptionKeyCount,
}: {
  setupComplete: boolean
  issues: ConfigIssue[]
  fallbackEncryptionKeyCount: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <Alert>
        {setupComplete
          ? <CheckCircleIcon aria-hidden="true" />
          : <WarningCircleIcon aria-hidden="true" />}
        <AlertTitle>
          {setupComplete ? "Configuration is complete" : "Configuration required"}
        </AlertTitle>
        <AlertDescription>
          {setupComplete
            ? "Saved changes apply immediately on this server. Restart other running server instances to load them."
            : (
              <ul className="list-disc pl-4">
                {issues.map((issue) => (
                  <li key={`${issue.key}-${issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            )}
        </AlertDescription>
      </Alert>
      {fallbackEncryptionKeyCount > 0 && (
        <Alert>
          <CheckCircleIcon aria-hidden="true" />
          <AlertTitle>Encryption key rotation in progress</AlertTitle>
          <AlertDescription>
            New values use the active key; {fallbackEncryptionKeyCount} fallback key
            {fallbackEncryptionKeyCount === 1 ? " is" : "s are"} available for older values.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
