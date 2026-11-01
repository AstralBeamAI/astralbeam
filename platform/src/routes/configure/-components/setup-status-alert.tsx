import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"

import { DocsLink } from "@/components/docs-link"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { ConfigIssue } from "@/lib/config/types"
import type { ConfigureField } from "../-lib/types"

export function SetupStatusAlert({
  setupComplete,
  issues,
  pendingMigrationCount,
  fallbackEncryptionKeyCount,
  testingDefaults,
  fields,
}: {
  setupComplete: boolean
  issues: ConfigIssue[]
  pendingMigrationCount: number
  fallbackEncryptionKeyCount: number
  testingDefaults: string[]
  fields: ConfigureField[]
}) {
  if (setupComplete && fallbackEncryptionKeyCount === 0 && testingDefaults.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {!setupComplete && (
        <Alert className="rounded-xl border-warning/40 bg-warning/5 p-4">
          <WarningCircleIcon aria-hidden="true" />
          <AlertTitle className="text-sm font-semibold">Configuration required</AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <ul className="list-disc pl-4">
              {pendingMigrationCount > 0 && (
                <li>
                  <Link
                    to="/configure"
                    hash="pending-migrations"
                    className="underline underline-offset-4"
                  >
                    Apply {pendingMigrationCount} pending database migration
                    {pendingMigrationCount === 1 ? "" : "s"}.
                  </Link>
                </li>
              )}
              {issues.map((issue) => (
                <li key={`${issue.key}-${issue.message}`}>
                  {pendingMigrationCount > 0 ? (
                    issue.message
                  ) : (
                    <Link
                      to="/configure"
                      hash={
                        issue.key.startsWith("dogfood_")
                          ? "configure-owner"
                          : `configure-${fields
                              .find((field) => field.key === issue.key)!
                              .group.toLowerCase()
                              .replaceAll(" ", "-")}`
                      }
                      className="underline underline-offset-4"
                    >
                      {issue.message}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {fallbackEncryptionKeyCount > 0 && (
        <Alert>
          <CheckCircleIcon aria-hidden="true" />
          <AlertTitle>Fallback encryption keys configured</AlertTitle>
          <AlertDescription>
            New values use the active key; {fallbackEncryptionKeyCount} fallback key
            {fallbackEncryptionKeyCount === 1 ? " is" : "s are"} available for older values.{" "}
            <DocsLink href="/docs/self-hosting/security#rotating-the-encryption-key">
              Finish rotating the encryption key
            </DocsLink>
          </AlertDescription>
        </Alert>
      )}
      {testingDefaults.length > 0 && (
        <Alert>
          <AlertTitle>Local testing defaults active</AlertTitle>
          <AlertDescription>{testingDefaults.join(" · ")}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
