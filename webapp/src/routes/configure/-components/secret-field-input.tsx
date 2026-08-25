"use client"

import { ArrowsClockwiseIcon, XIcon } from "@phosphor-icons/react"

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
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { ConfigureField, FieldDraft } from "../-lib/types"

export function SecretFieldInput({
  field,
  draft,
  onDraftChange,
  onRotate,
  disabled,
}: {
  field: ConfigureField
  draft: FieldDraft
  onDraftChange: (draft: FieldDraft) => void
  onRotate?: (() => void) | undefined
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {draft.kind === "clear"
          ? <Badge variant="outline">Cleared on save</Badge>
          : field.isSet
          ? (
            <Badge variant="secondary">
              Configured <span aria-hidden="true">••••••••</span>
            </Badge>
          )
          : <Badge variant="outline">Not configured</Badge>}
        {draft.kind !== "set" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onDraftChange({ kind: "set", value: "" })}
          >
            {field.isSet ? "Replace" : "Set value"}
          </Button>
        )}
        {field.isSet && draft.kind === "unchanged" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onDraftChange({ kind: "clear" })}
          >
            Clear
          </Button>
        )}
        {draft.kind !== "unchanged" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`Discard the pending change to ${field.label}`}
            title={`Discard the pending change to ${field.label}`}
            onClick={() => onDraftChange({ kind: "unchanged" })}
          >
            <XIcon aria-hidden="true" />
          </Button>
        )}
        {field.canGenerate && onRotate && (
          <AlertDialog>
            <AlertDialogTrigger
              type="button"
              disabled={disabled}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <ArrowsClockwiseIcon aria-hidden="true" />
              {field.isSet ? "Rotate" : "Generate"}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {field.isSet ? "Rotate" : "Generate"} {field.label.toLowerCase()}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This stores a new random value immediately. {field.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onRotate}>
                  {field.isSet ? "Rotate" : "Generate"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {draft.kind === "set" && (
        <Input
          type="password"
          autoComplete="off"
          placeholder={`New ${field.label.toLowerCase()}`}
          value={draft.value}
          disabled={disabled}
          onChange={(event) => onDraftChange({ kind: "set", value: event.target.value })}
        />
      )}
    </div>
  )
}
