"use client"

import { ArrowsClockwiseIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { type ReactNode, useState } from "react"

import { DocsLink } from "@/components/docs-link"
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
  InputGroupTextarea,
} from "@/components/ui/input-group"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { CopyValueButton } from "./copy-value-button"

export function ConfigValueInput({
  field,
  draft,
  revealedValue,
  onReveal,
  onDraftChange,
  footer,
  onGenerate,
  disabled,
}: {
  field: ConfigureField
  draft: FieldDraft
  /** Secret already fetched by `onReveal`; plain fields carry their value on `field`. */
  revealedValue?: string | undefined
  onReveal?: (() => Promise<boolean>) | undefined
  onDraftChange: (draft: FieldDraft) => void
  footer?: ReactNode
  onGenerate?: (() => void) | undefined
  disabled: boolean
}) {
  const [visible, setVisible] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const revealed = revealedValue !== undefined
  const hasLocalValue = revealed || draft.kind === "set"
  const [previousHasLocalValue, setPreviousHasLocalValue] = useState(hasLocalValue)
  if (hasLocalValue !== previousHasLocalValue) {
    setPreviousHasLocalValue(hasLocalValue)
    if (!hasLocalValue) setVisible(false)
  }
  const [confirmGenerateOpen, setConfirmGenerateOpen] = useState(false)
  const value = draft.kind === "set" ? draft.value : (revealedValue ?? field.value ?? "")
  const readOnly = field.source === "environment"
  const needsReveal = field.kind === "secret" && field.isSet && !revealed
  const valueVisible = field.kind !== "secret" || visible
  const multiline = field.key === "cloudfront_private_key"
  const ValueInput = multiline && valueVisible ? InputGroupTextarea : InputGroupInput

  const revealValue = async () => {
    if (!needsReveal) {
      setVisible(true)
      return
    }
    setRevealing(true)
    try {
      if (await onReveal?.()) setVisible(true)
    } finally {
      setRevealing(false)
    }
  }
  const storageMessage =
    field.storageStatus === "fallback-key"
      ? "Encrypted with a fallback key; replace and save it to use the active key."
      : field.storageStatus === "unreadable"
        ? "The stored value cannot be read. Enter a replacement or press Delete in an empty optional field to clear it, then save."
        : null

  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <ValueInput
          id={`config-${field.key}`}
          type={!valueVisible ? "password" : field.kind === "url" ? "url" : undefined}
          autoComplete={
            field.kind === "secret" && !(multiline && valueVisible) ? "new-password" : "off"
          }
          value={value}
          placeholder={field.isSet ? "Configured" : "Not set"}
          disabled={disabled || readOnly}
          onChange={(event) => onDraftChange({ kind: "set", value: event.target.value })}
          onPaste={(event) => {
            if (!multiline || valueVisible) return
            event.preventDefault()
            onDraftChange({ kind: "set", value: event.clipboardData.getData("text") })
          }}
        />
        <InputGroupAddon align="inline-end">
          {valueVisible && value && <CopyValueButton value={value} label={field.label} />}
          {field.kind === "secret" && (
            <InputGroupButton
              size="icon-xs"
              aria-label={`${visible ? "Hide" : "Show"} ${field.label}`}
              title={`${visible ? "Hide" : "Show"} ${field.label}`}
              disabled={disabled || revealing || (!visible && !needsReveal && !value)}
              onClick={() => {
                if (visible) setVisible(false)
                else void revealValue()
              }}
            >
              {visible ? <EyeSlashIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
      {storageMessage && (
        <span
          className={
            field.storageStatus === "unreadable"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {storageMessage}{" "}
          <DocsLink
            href={`/docs/self-hosting/security#${
              field.storageStatus === "unreadable"
                ? "unreadable-values"
                : "rotating-the-encryption-key"
            }`}
          >
            {field.storageStatus === "unreadable" ? "Recover this setting" : "Key rotation guide"}
          </DocsLink>
        </span>
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
