import { authQueryKeys } from "@better-auth-ui/core"
import { queryOptions } from "@tanstack/react-query"

import { $getSession } from "./functions"

export const authSessionQueryOptions = queryOptions({
  // Share Better Auth UI's session cache so its sign-out mutation invalidates route guards too. https://better-auth-ui.com/docs/shadcn/integrations/tanstack-start#protecting-routes
  queryKey: authQueryKeys.session,
  queryFn: ({ signal }) => $getSession({ signal }),
})
