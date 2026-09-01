// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Use Phosphor icons and the contextual Base UI toast manager; show separate public ID and one-time secret fields with paired environment-variable copy; require explicit dismissal of the secret.

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
  secretKey: string | null
  publicKeyId: string | null
}

export function NewApiKeyDialog({
  open,
  onOpenChange,
  name,
  secretKey,
  publicKeyId,
}: NewApiKeyDialogProps) {
  const { localization } = useAuth()
  const { localization: apiKeyLocalization } = useAuthPlugin(apiKeyPlugin)

  const [copiedValue, setCopiedValue] = useState<"environment" | "id" | "secret" | null>(null)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCopiedValue(null)
    }

    onOpenChange(nextOpen)
  }

  const copyApiKeyValue = async (
    kind: "environment" | "id" | "secret",
    value: string | null,
  ) => {
    if (!value) return
    try {
      await globalThis.navigator.clipboard.writeText(value)
      setCopiedValue(kind)
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
            id="new-api-key-id"
            label="API key ID"
            value={publicKeyId}
            copied={copiedValue === "id"}
            copiedLabel={localization.settings.copiedToClipboard}
            copyLabel={localization.settings.copyToClipboard}
            onCopy={() => void copyApiKeyValue("id", publicKeyId)}
          />

          <ApiKeyCopyField
            id="new-api-key-secret"
            label="API key secret"
            value={secretKey}
            copied={copiedValue === "secret"}
            copiedLabel={localization.settings.copiedToClipboard}
            copyLabel={localization.settings.copyToClipboard}
            onCopy={() => void copyApiKeyValue("secret", secretKey)}
          />

          <p className="text-xs text-muted-foreground">
            Call <code className="font-mono text-foreground">createAstralBeamChatToken</code>{" "}
            with this ID and secret on your server. Never expose the secret in browser code; it is
            shown only once and cannot be recovered.
          </p>

          <Button
            type="button"
            variant="outline"
            disabled={!publicKeyId || !secretKey}
            onClick={() =>
              void copyApiKeyValue(
                "environment",
                publicKeyId && secretKey
                  ? `ASTRALBEAM_API_KEY_ID=${publicKeyId}\nASTRALBEAM_API_KEY=${secretKey}`
                  : null,
              )}
          >
            {copiedValue === "environment"
              ? <CheckIcon aria-hidden="true" />
              : <CopyIcon aria-hidden="true" />}
            Copy environment variables
          </Button>
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
