import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ConfigureIssue } from "../-lib/types"

export function SetupStatusAlert({
  setupComplete,
  issues,
}: {
  setupComplete: boolean
  issues: ConfigureIssue[]
}) {
  return (
    <Alert>
      {setupComplete
        ? <CheckCircleIcon aria-hidden="true" />
        : <WarningCircleIcon aria-hidden="true" />}
      <AlertTitle>{setupComplete ? "Setup is complete" : "Finish setting up"}</AlertTitle>
      <AlertDescription>
        {setupComplete
          ? "Saved changes apply within about ten seconds and reach every server instance."
          : issues.length === 0
          ? "Everything required is in place; finish setup to open the app."
          : (
            <ul className="list-disc pl-4">
              {issues.map((issue) => <li key={`${issue.key}-${issue.message}`}>{issue.message}
              </li>)}
            </ul>
          )}
      </AlertDescription>
    </Alert>
  )
}
