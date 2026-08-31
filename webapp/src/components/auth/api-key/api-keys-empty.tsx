// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Use Phosphor icons; support exact optional property types.

"use client"

import { useAuthPlugin } from "@better-auth-ui/react"
import { KeyIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin"

export type ApiKeysEmptyProps = {
  onCreatePress: () => void
  hideCreate?: boolean | undefined
}

export function ApiKeysEmpty({ onCreatePress, hideCreate }: ApiKeysEmptyProps) {
  const { localization: apiKeyLocalization } = useAuthPlugin(apiKeyPlugin)

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{apiKeyLocalization.noApiKeys}</EmptyTitle>
        <EmptyDescription>
          {apiKeyLocalization.apiKeysDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {!hideCreate && (
          <Button size="sm" onClick={onCreatePress}>
            {apiKeyLocalization.createApiKey}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  )
}
