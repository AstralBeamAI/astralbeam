"use client"

import { ArrowsClockwiseIcon, EyeIcon, EyeSlashIcon, XIcon } from "@phosphor-icons/react"
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
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { CopyValueButton } from "./copy-value-button"

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
  const [visible, setVisible] = useState(false)
  const [confirmRotateOpen, setConfirmRotateOpen] = useState(false)

  const value = draft.kind === "set" ? draft.value : field.value ?? ""

  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupInput
          id={`config-${field.key}`}
          type={visible ? "text" : "password"}
          autoComplete="off"
          value={value}
          placeholder="Not set"
          disabled={disabled}
          onChange={(event) => onDraftChange({ kind: "set", value: event.target.value })}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={visible ? `Hide ${field.label}` : `Show ${field.label}`}
            title={visible ? `Hide ${field.label}` : `Show ${field.label}`}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeSlashIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </InputGroupButton>
          <CopyValueButton value={value} label={field.label} />
        </InputGroupAddon>
      </InputGroup>
      {(draft.kind !== "unchanged" || (field.canGenerate && onRotate !== undefined)) && (
        <div className="flex flex-wrap items-center gap-2">
          {draft.kind !== "unchanged" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setVisible(false)
                onDraftChange({ kind: "unchanged" })
              }}
            >
              <XIcon aria-hidden="true" />
              Discard
            </Button>
          )}
          {field.canGenerate && onRotate !== undefined && draft.kind === "unchanged" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setConfirmRotateOpen(true)}
            >
              <ArrowsClockwiseIcon aria-hidden="true" />
              {field.isSet ? "Rotate" : "Generate"}
            </Button>
          )}
        </div>
      )}
      <AlertDialog open={confirmRotateOpen} onOpenChange={setConfirmRotateOpen}>
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
            <AlertDialogAction
              onClick={() => {
                setConfirmRotateOpen(false)
                setVisible(false)
                onRotate?.()
              }}
            >
              {field.isSet ? "Rotate" : "Generate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
