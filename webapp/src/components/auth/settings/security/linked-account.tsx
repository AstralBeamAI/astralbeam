// Added with: deno task ui add @better-auth-ui/settings
// Local changes: Use Phosphor icons, Base UI Toast, safer OAuth callback/error URLs, strict typing, and skip account-info requests for unlinked providers.

import {
  type AuthSocialProvider,
  getAuthLinkURL,
  getProviderId,
  getProviderName,
  getSafeRedirectTo,
  isSessionNotFreshError,
} from "@better-auth-ui/core"
import {
  renderProviderIcon,
  useAccountInfo,
  useAuth,
  useLinkSocial,
  useUnlinkAccount,
} from "@better-auth-ui/react"
import type { Account } from "better-auth"
import {
  LinkBreakIcon as Link2Off,
  LinkIcon as Link2,
  PlugsConnectedIcon as Plug,
} from "@phosphor-icons/react"
import { toast } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { FreshSessionPrompt } from "./fresh-session-prompt"

export type LinkedAccountProps = {
  account?: Account | undefined
  canUnlink?: boolean
  provider: AuthSocialProvider | string
}

/**
 * Render a single linked social account row with provider info and link/unlink control.
 *
 * Fetches additional account information from the provider using the accountInfo API
 * and displays the provider name, account details, and a link/unlink button.
 *
 * @param account - The account object containing id, accountId, and providerId
 * @param provider - The provider id
 * @returns A JSX element containing the linked account row
 */
export function LinkedAccount({
  account,
  canUnlink = true,
  provider,
}: LinkedAccountProps) {
  const {
    authClient,
    basePaths,
    baseURL,
    localization,
    viewPaths,
  } = useAuth()

  const { data: accountInfo, isPending: isLoadingInfo } = useAccountInfo(
    authClient,
    {
      query: { accountId: account?.id ?? "" },
      enabled: Boolean(account),
    },
  )

  const { mutate: linkSocial, isPending: isLinking } = useLinkSocial(authClient)

  const unlinkAccount = useUnlinkAccount(authClient, {
    onSuccess: () => toast.add({ title: localization.settings.accountUnlinked, type: "success" }),
  })

  const providerId = getProviderId(provider)
  const providerIcon = renderProviderIcon(provider)
  const providerName = getProviderName(provider)
  const accountData = accountInfo?.data as
    | { login?: string; username?: string }
    | undefined

  const displayName = accountData?.login ||
    accountData?.username ||
    accountInfo?.user?.email ||
    accountInfo?.user?.name ||
    account?.accountId

  const needsFreshSession = isSessionNotFreshError(unlinkAccount.error)

  return (
    <>
      <Item>
        <ItemMedia variant="icon" className={cn(!account && "opacity-50")}>
          {providerIcon ? providerIcon : <Plug />}
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{providerName}</ItemTitle>
          {account && isLoadingInfo ? <Skeleton className="my-0.5 h-3 w-24" /> : (
            <ItemDescription>
              {account ? displayName : localization.settings.linkProvider.replace(
                "{{provider}}",
                providerName,
              )}
            </ItemDescription>
          )}
        </ItemContent>
        <ItemActions>
          {account
            ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => unlinkAccount.mutate({ accountId: account.id })}
                disabled={unlinkAccount.isPending || !canUnlink}
                title={canUnlink ? undefined : localization.settings.lastAccountUnlinkingDisabled}
                aria-label={localization.settings.unlinkProvider.replace(
                  "{{provider}}",
                  providerName,
                )}
              >
                {unlinkAccount.isPending ? <Spinner /> : <Link2Off />}
                {localization.settings.unlinkProvider
                  .replace("{{provider}}", "")
                  .trim()}
              </Button>
            )
            : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const safeReturnPath = getSafeRedirectTo(
                    globalThis.location.pathname,
                    globalThis.location.origin,
                  )
                  linkSocial({
                    provider: providerId,
                    callbackURL: `${baseURL}${safeReturnPath}`,
                    errorCallbackURL: getAuthLinkURL(
                      `${baseURL}${basePaths.auth}/${viewPaths.auth.error}`,
                      safeReturnPath,
                    ),
                  })
                }}
                disabled={isLinking}
                aria-label={localization.settings.linkProvider.replace(
                  "{{provider}}",
                  providerName,
                )}
              >
                {isLinking ? <Spinner /> : <Link2 />}
                {localization.settings.link}
              </Button>
            )}
        </ItemActions>
      </Item>
      {account && (
        <Dialog
          open={needsFreshSession}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) unlinkAccount.reset()
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="sr-only">
                {localization.settings.freshSessionTitle}
              </DialogTitle>
            </DialogHeader>
            <FreshSessionPrompt
              onFresh={() => unlinkAccount.mutate({ accountId: account.id })}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
