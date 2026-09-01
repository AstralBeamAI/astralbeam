// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Use Phosphor icons; support exact optional property types; handle keys without a stored prefix; show the public key ID and product rate limit.

import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { CopyIcon, KeyIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin"
import {
  ORGANIZATION_API_KEY_RATE_LIMIT_DESCRIPTION,
  type OrganizationApiKey,
} from "@/lib/auth/organization-api-key-configuration"
import { toast } from "@/components/ui/toast"
import { DeleteApiKeyDialog } from "./delete-api-key-dialog"
import { EditApiKeyDialog } from "./edit-api-key-dialog"

export type ApiKeyProps = {
  apiKey: OrganizationApiKey
  organizationSlug?: string | undefined
  /** Hide the row's delete button (e.g., when caller lacks `apiKey:delete`). */
  hideDelete?: boolean | undefined
  /** Hide the row's edit button (e.g., when caller lacks `apiKey:update`). */
  hideUpdate?: boolean | undefined
  /** Called after this key is deleted. */
  onDeleted?: (() => void) | undefined
}

export function ApiKey({
  apiKey,
  organizationSlug,
  hideDelete,
  hideUpdate,
  onDeleted,
}: ApiKeyProps) {
  const { localization } = useAuth()
  const { localization: apiKeyLocalization } = useAuthPlugin(apiKeyPlugin)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const keyPrefix = apiKey.start ? `${apiKey.start}…` : "Unavailable"
  const publicId = organizationSlug ? `key_${organizationSlug}_${apiKey.slug}` : null

  return (
    <Item>
      <ItemMedia variant="icon">
        <KeyIcon aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{apiKey.name || apiKeyLocalization.apiKey}</ItemTitle>
        {publicId && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              API key ID
            </span>
            <ItemDescription className="min-w-0 truncate font-mono">{publicId}</ItemDescription>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Copy ${apiKey.name || "API key"} ID`}
              title={`Copy ${apiKey.name || "API key"} ID`}
              onClick={() => void copyApiKeyPublicId(publicId)}
            >
              <CopyIcon aria-hidden="true" />
            </Button>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            Key prefix
          </span>
          <ItemDescription className="min-w-0 truncate font-mono">{keyPrefix}</ItemDescription>
        </div>
        <ItemDescription>
          {apiKeyLocalization.created} {new Date(apiKey.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </ItemDescription>
        <ItemDescription>
          {apiKey.expiresAt
            ? `${apiKeyLocalization.expires} ${
              new Date(
                apiKey.expiresAt,
              ).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            }`
            : apiKeyLocalization.neverExpires}
        </ItemDescription>
        <ItemDescription>
          {apiKey.enabled ? apiKeyLocalization.enabled : apiKeyLocalization.disabled}
        </ItemDescription>
        <ItemDescription>
          {ORGANIZATION_API_KEY_RATE_LIMIT_DESCRIPTION}
        </ItemDescription>
        <ItemDescription>
          {apiKeyLocalization.lastRequest}: {apiKey.lastRequest
            ? new Date(apiKey.lastRequest).toLocaleString()
            : apiKeyLocalization.neverRequested}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {!hideUpdate && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
            >
              <PencilSimpleIcon aria-hidden="true" />
              {apiKeyLocalization.editApiKey}
            </Button>
            <EditApiKeyDialog
              apiKey={apiKey}
              publicId={publicId}
              open={editOpen}
              onOpenChange={setEditOpen}
            />
          </>
        )}
        {!hideDelete && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              aria-label={apiKeyLocalization.deleteApiKey}
            >
              <XIcon aria-hidden="true" />

              {localization.settings.delete}
            </Button>

            <DeleteApiKeyDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              apiKey={apiKey}
              onDeleted={onDeleted}
            />
          </>
        )}
      </ItemActions>
    </Item>
  )
}

async function copyApiKeyPublicId(publicId: string): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(publicId)
    toast.add({ title: "API key ID copied", type: "success" })
  } catch {
    toast.add({ title: "The API key ID could not be copied", type: "error" })
  }
}
