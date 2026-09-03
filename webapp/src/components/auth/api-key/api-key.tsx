// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Use Phosphor icons and support exact optional property types.

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
import type { OrganizationApiKey } from "@/lib/auth/organization-api-key-configuration"
import { DeleteApiKeyDialog } from "./delete-api-key-dialog"
import { EditApiKeyDialog } from "./edit-api-key-dialog"

export type ApiKeyProps = {
  apiKey: OrganizationApiKey
  /** Hide the row's delete button (e.g., when caller lacks `apiKey:delete`). */
  hideDelete?: boolean | undefined
  /** Hide the row's edit button (e.g., when caller lacks `apiKey:update`). */
  hideUpdate?: boolean | undefined
  /** Called after this key is deleted. */
  onDeleted?: (() => void) | undefined
}

export function ApiKey({
  apiKey,
  hideDelete,
  hideUpdate,
  onDeleted,
}: ApiKeyProps) {
  const { localization } = useAuth()
  const { localization: apiKeyLocalization } = useAuthPlugin(apiKeyPlugin)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <Item>
      <ItemMedia variant="icon">
        <KeyIcon aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{apiKey.name || apiKeyLocalization.apiKey}</ItemTitle>
        <ItemDescription>
          {apiKeyLocalization.created} {new Date(apiKey.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })} · {apiKey.expiresAt
            ? `${apiKeyLocalization.expires} ${
              new Date(
                apiKey.expiresAt,
              ).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            }`
            : apiKeyLocalization.neverExpires} ·{" "}
          {apiKey.enabled ? apiKeyLocalization.enabled : apiKeyLocalization.disabled}
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
              onDeleted={onDeleted}
            />
          </>
        )}
      </ItemActions>
    </Item>
  )
}
