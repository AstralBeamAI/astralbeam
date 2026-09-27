// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Use Phosphor icons, show one key with manual copy recovery, and require explicit dismissal of the secret.

import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { CheckIcon, CopyIcon, KeyIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin"

export type NewApiKeyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string | null
  apiKey: string | null
}

export function NewApiKeyDialog({ open, onOpenChange, name, apiKey }: NewApiKeyDialogProps) {
  const { localization } = useAuth()
  const { localization: apiKeyLocalization } = useAuthPlugin(apiKeyPlugin)

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle")
  const apiKeyInputRef = useRef<HTMLInputElement>(null)
  const copyLabel =
    copyStatus === "copied"
      ? localization.settings.copiedToClipboard
      : localization.settings.copyToClipboard

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCopyStatus("idle")
    }

    onOpenChange(nextOpen)
  }

  const copyApiKey = async () => {
    if (!apiKey) return
    setCopyStatus("idle")
    try {
      await globalThis.navigator.clipboard.writeText(apiKey)
      setCopyStatus("copied")
    } catch {
      setCopyStatus("failed")
      apiKeyInputRef.current?.focus()
      apiKeyInputRef.current?.select()
    }
  }

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen) {
          eventDetails.cancel()
          return
        }
        handleOpenChange(nextOpen)
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyIcon aria-hidden="true" />
            {apiKeyLocalization.newApiKey}
          </DialogTitle>

          <DialogDescription>{apiKeyLocalization.newApiKeyWarning}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium">{name || apiKeyLocalization.apiKey}</p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-api-key">API key</Label>
            <InputGroup>
              <InputGroupInput
                ref={apiKeyInputRef}
                id="new-api-key"
                value={apiKey ?? ""}
                readOnly
                aria-describedby={copyStatus === "failed" ? "new-api-key-copy-help" : undefined}
                className="font-mono text-xs"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label={copyLabel}
                  title={copyLabel}
                  onClick={() => void copyApiKey()}
                >
                  {copyStatus === "copied" ? (
                    <CheckIcon aria-hidden="true" />
                  ) : (
                    <CopyIcon aria-hidden="true" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {copyStatus === "failed" && (
              <p id="new-api-key-copy-help" role="alert" className="text-sm text-destructive">
                Couldn&apos;t copy automatically. Use your browser or keyboard to copy the selected
                key before dismissing this dialog.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Use this key only with{" "}
            <code className="font-mono text-foreground">createAstralBeamToken</code> on your server,
            to mint chat auth tokens for your tenant users. Never expose it in browser code.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => handleOpenChange(false)}>
            {apiKeyLocalization.dismissNewKey}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
