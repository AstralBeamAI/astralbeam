"use client"

import { ArrowsClockwiseIcon, EyeIcon, EyeSlashIcon, TrashIcon, XIcon } from "@phosphor-icons/react"
import { type ReactNode, useState } from "react"

import { Button } from "@/components/ui/button"
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { CopyValueButton } from "./copy-value-button"

export function ConfigValueInput({
  field,
  draft,
  onDraftChange,
  footer,
  onGenerate,
  disabled,
}: {
  field: ConfigureField
  draft: FieldDraft
  onDraftChange: (draft: FieldDraft) => void
  footer?: ReactNode
  onGenerate?: (() => void) | undefined
  disabled: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [confirmGenerateOpen, setConfirmGenerateOpen] = useState(false)
  const value = draft.kind === "set" ? draft.value : field.value ?? ""
  const readOnly = field.source === "environment"
  const valueVisible = field.kind !== "secret" || visible
  const storageMessage = field.storageStatus === "fallback-key"
    ? "Encrypted with a fallback key; replace and save it to use the active key."
    : field.storageStatus === "unreadable"
    ? "The stored value cannot be read; enter and save a replacement."
    : null

  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupInput
          id={`config-${field.key}`}
          type={valueVisible ? (field.kind === "url" ? "url" : "text") : "password"}
          autoComplete={field.kind === "secret" ? "new-password" : "off"}
          value={value}
          placeholder={field.isSet ? "Configured" : "Not set"}
          disabled={disabled || readOnly}
          onChange={(event) => onDraftChange({ kind: "set", value: event.target.value })}
        />
        <InputGroupAddon align="inline-end">
          {valueVisible && value && <CopyValueButton value={value} label={field.label} />}
          {field.kind === "secret" && (
            <InputGroupButton
              size="icon-xs"
              aria-label={`${visible ? "Hide" : "Show"} ${field.label}`}
              title={`${visible ? "Hide" : "Show"} ${field.label}`}
              disabled={disabled || !value}
              onClick={() => setVisible((current) => !current)}
            >
              {visible ? <EyeSlashIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
      {storageMessage && (
        <span
          className={field.storageStatus === "unreadable"
            ? "text-sm text-destructive"
            : "text-sm text-muted-foreground"}
        >
          {storageMessage}
        </span>
      )}
      {!readOnly && (draft.kind !== "unchanged" || field.isSet) && (
        <div className="flex flex-wrap items-center gap-2">
          {draft.kind !== "unchanged" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onDraftChange({ kind: "unchanged" })}
            >
              <XIcon aria-hidden="true" />
              Discard
            </Button>
          )}
          {field.isSet && !field.required && draft.kind === "unchanged" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onDraftChange({ kind: "clear" })}
            >
              <TrashIcon aria-hidden="true" />
              Clear value
            </Button>
          )}
          {draft.kind === "clear" && (
            <span className="text-sm text-destructive">This value will be cleared on save.</span>
          )}
        </div>
      )}
      {!readOnly && field.canGenerate && onGenerate && draft.kind === "unchanged" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={disabled}
          onClick={() => setConfirmGenerateOpen(true)}
        >
          <ArrowsClockwiseIcon aria-hidden="true" />
          {field.isSet ? "Rotate" : "Generate"}
        </Button>
      )}
      {!readOnly && footer}
      <AlertDialog open={confirmGenerateOpen} onOpenChange={setConfirmGenerateOpen}>
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
                setConfirmGenerateOpen(false)
                onGenerate?.()
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
