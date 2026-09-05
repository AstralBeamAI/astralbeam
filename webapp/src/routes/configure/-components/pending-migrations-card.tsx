"use client"

import { CaretDownIcon } from "@phosphor-icons/react"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "cn"
import { applyMigrations } from "../-functions/apply-migrations"
import type { PendingMigration } from "../-lib/types"

export function PendingMigrationsCard({
  pending,
  appliedCount,
  onApplied,
}: {
  pending: PendingMigration[]
  appliedCount: number
  onApplied: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pendingApply, setPendingApply] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleApply = async () => {
    setPendingApply(true)
    setError(null)
    try {
      const result = await applyMigrations({
        data: {
          approvedMigrations: pending.map(({ name, hash }) => ({ name, hash })),
        },
      })
      if (result.ok) {
        onApplied()
        return
      }
      setError(result.error ?? "The migrations could not be applied")
    } catch {
      setError("The migrations could not be applied")
    } finally {
      setPendingApply(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Database migrations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {pending.length} pending migration{pending.length === 1 ? "" : "s"}{" "}
          must run before configuration ({appliedCount}{" "}
          already applied). Review the SQL, then apply.
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Migration failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <ul className="flex flex-col gap-2">
          {pending.map((migration) => (
            <li key={migration.name}>
              <Collapsible className="rounded-md border">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium">
                  <span className="break-all">{migration.name}</span>
                  <CaretDownIcon aria-hidden="true" className="shrink-0" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="max-h-80 overflow-auto border-t bg-muted/50 p-3 text-xs">
                    {migration.sql}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </li>
          ))}
        </ul>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger
            type="button"
            disabled={pendingApply}
            className={cn(buttonVariants(), "self-start")}
          >
            {pendingApply && <Spinner />}
            Apply {pending.length} migration{pending.length === 1 ? "" : "s"}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply pending migrations?</AlertDialogTitle>
              <AlertDialogDescription>
                This runs the {pending.length} reviewed migration
                {pending.length === 1 ? "" : "s"}{" "}
                against the database. Back up the database first if it holds data you cannot lose.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmOpen(false)
                  void handleApply()
                }}
              >
                Apply migrations
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
