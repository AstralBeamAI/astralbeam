// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Use Phosphor icons; show the public ID; support exact optional property types; notify the paginated list after deletion.

import type { ApiKeyAuthClient } from "@better-auth-ui/core/plugins/api-key"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useDeleteApiKey } from "@better-auth-ui/react/plugins/api-key"
import { KeyIcon } from "@phosphor-icons/react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin"
import type { OrganizationApiKey } from "@/lib/auth/organization-api-key-configuration"

export type DeleteApiKeyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: OrganizationApiKey
  publicId: string
  onDeleted?: (() => void) | undefined
}

export function DeleteApiKeyDialog({
  open,
  onOpenChange,
  apiKey,
  publicId,
  onDeleted,
}: DeleteApiKeyDialogProps) {
  const { authClient, localization } = useAuth<ApiKeyAuthClient>()
  const { localization: apiKeyLocalization } = useAuthPlugin(apiKeyPlugin)
  const previewId = `delete-api-key-preview-${apiKey.id}`
  const { mutate: deleteApiKey, isPending: isDeleting } = useDeleteApiKey(
    authClient,
    {
      onSuccess: () => {
        onOpenChange(false)
        onDeleted?.()
      },
    },
  )

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <KeyIcon aria-hidden="true" />
          </AlertDialogMedia>

          <AlertDialogTitle>{apiKeyLocalization.deleteApiKey}</AlertDialogTitle>

          <AlertDialogDescription>
            {apiKeyLocalization.deleteApiKeyWarning}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field>
          <FieldLabel htmlFor={previewId}>
            API key ID
          </FieldLabel>

          <Input
            id={previewId}
            value={publicId}
            readOnly
            className="font-mono text-xs"
          />
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {localization.settings.cancel}
          </AlertDialogCancel>

          <Button
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={() =>
              deleteApiKey({
                keyId: apiKey.id,
              })}
          >
            {isDeleting && <Spinner />}

            {apiKeyLocalization.deleteApiKey}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
