// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Keep organization-only API keys on their dedicated organization route.

import { createAuthPlugin } from "@better-auth-ui/core"
import {
  apiKeyPlugin as coreApiKeyPlugin,
  type ApiKeyPluginOptions,
} from "@better-auth-ui/core/plugins/api-key"

import { ApiKeys } from "@/components/auth/api-key/api-keys"

export const apiKeyPlugin = createAuthPlugin(
  coreApiKeyPlugin.id,
  (options: ApiKeyPluginOptions = {}) => {
    const core = coreApiKeyPlugin(options)

    return {
      ...core,
      securityCards: core.organization ? [] : [ApiKeys],
    }
  },
)
