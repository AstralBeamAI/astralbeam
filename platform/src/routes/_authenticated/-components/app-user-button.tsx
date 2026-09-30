import { useAuth } from "@better-auth-ui/react"
import { BriefcaseIcon, ShieldCheckIcon, UserCircleIcon } from "@phosphor-icons/react"

import { UserButton, type UserButtonProps } from "@/components/auth/user/user-button"
// Load the Better Auth UI Link module augmentation used by useAuth().
import type {} from "@/components/auth/auth-provider"

/** The signed-in user's menu, linking to the user-level pages. */
export function AppUserButton(props: Pick<UserButtonProps, "align" | "size" | "className">) {
  const { localization } = useAuth()
  return (
    <UserButton
      hideSettings
      links={[
        {
          href: "/settings/account",
          icon: <UserCircleIcon className="text-muted-foreground" />,
          label: localization.settings.account,
          visibility: "authenticated",
        },
        {
          href: "/settings/security",
          icon: <ShieldCheckIcon className="text-muted-foreground" />,
          label: localization.settings.security,
          visibility: "authenticated",
        },
        {
          href: "/organizations",
          icon: <BriefcaseIcon className="text-muted-foreground" />,
          label: "Organizations",
          visibility: "authenticated",
        },
      ]}
      {...props}
    />
  )
}
