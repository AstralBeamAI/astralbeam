// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Use Phosphor icons and the contextual Base UI toast manager; show one copyable API key; require explicit dismissal of the secret.

import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { CheckIcon, CopyIcon, KeyIcon } from "@phosphor-icons/react"
import { useState } from "react"

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
import { toast } from "@/components/ui/toast"
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin"

export type NewApiKeyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string | null
  apiKey: string | null
}

export function NewApiKeyDialog({
  open,
  onOpenChange,
  name,
  apiKey,
}: NewApiKeyDialogProps) {
  const { localization } = useAuth()
  const { localization: apiKeyLocalization } = useAuthPlugin(apiKeyPlugin)

  const [copied, setCopied] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCopied(false)
    }

    onOpenChange(nextOpen)
  }

  const copyApiKey = async () => {
    if (!apiKey) return
    try {
      await globalThis.navigator.clipboard.writeText(apiKey)
      setCopied(true)
    } catch {
      toast.add({ title: "The API key value could not be copied", type: "error" })
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

          <DialogDescription>
            {apiKeyLocalization.newApiKeyWarning}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium">{name || apiKeyLocalization.apiKey}</p>

          <ApiKeyCopyField
            id="new-api-key"
            label="API key"
            value={apiKey}
            copied={copied}
            copiedLabel={localization.settings.copiedToClipboard}
            copyLabel={localization.settings.copyToClipboard}
            onCopy={() => void copyApiKey()}
          />

          <p className="text-xs text-muted-foreground">
            Use this key with{" "}
            <code className="font-mono text-foreground">createAstralBeamChatToken</code>{" "}
            on your server. Never expose it to the browser; it won't be shown again.
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

function ApiKeyCopyField({
  id,
  label,
  value,
  copied,
  copiedLabel,
  copyLabel,
  onCopy,
}: {
  id: string
  label: string
  value: string | null
  copied: boolean
  copiedLabel: string
  copyLabel: string
  onCopy: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <InputGroup>
        <InputGroupInput
          id={id}
          value={value ?? ""}
          readOnly
          className="font-mono text-xs"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={copied ? copiedLabel : copyLabel}
            title={copied ? copiedLabel : copyLabel}
            onClick={onCopy}
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
