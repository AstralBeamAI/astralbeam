// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Use Phosphor icons; support exact optional property types; handle keys without a stored preview; show the product rate limit instead of Better Auth's disabled inactivity counter.

import type { ListedApiKey } from "@better-auth-ui/core/plugins/api-key"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { KeyIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react"
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
import { ORGANIZATION_API_KEY_RATE_LIMIT_DESCRIPTION } from "@/lib/auth/organization-api-key-configuration"
import { DeleteApiKeyDialog } from "./delete-api-key-dialog"
import { EditApiKeyDialog } from "./edit-api-key-dialog"

export type ApiKeyProps = {
  apiKey: ListedApiKey
  /** Hide the row's delete button (e.g., when caller lacks `apiKey:delete`). */
  hideDelete?: boolean | undefined
  /** Hide the row's edit button (e.g., when caller lacks `apiKey:update`). */
  hideUpdate?: boolean | undefined
}

export function ApiKey({
  apiKey,
  hideDelete,
  hideUpdate,
}: ApiKeyProps) {
  const { localization } = useAuth()
  const { localization: apiKeyLocalization } = useAuthPlugin(apiKeyPlugin)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const preview = `${apiKey.start ?? ""}${"*".repeat(16)}`

  return (
    <Item>
      <ItemMedia variant="icon">
        <KeyIcon aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{apiKey.name || apiKeyLocalization.apiKey}</ItemTitle>
        <ItemDescription className="font-mono">{preview}</ItemDescription>
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
          {apiKey.remaining === null
            ? ""
            : ` · ${apiKeyLocalization.remaining}: ${apiKey.remaining}`}
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
            />
          </>
        )}
      </ItemActions>
    </Item>
  )
}
