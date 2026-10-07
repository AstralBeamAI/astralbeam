import { useAuth } from "@better-auth-ui/react"
import {
  BriefcaseIcon,
  GlobeIcon,
  LifebuoyIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"
import { useState } from "react"

import { UserButton, type UserButtonProps } from "@/components/auth/user/user-button"
// Load the Better Auth UI Link module augmentation used by useAuth().
import type {} from "@/components/auth/auth-provider"
import { usePublicConfig } from "@/components/public-config-provider"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { ContactSupportDialog } from "./contact-support-dialog"

/** The signed-in user's menu, linking to the user-level pages. */
export function AppUserButton(props: Pick<UserButtonProps, "align" | "size" | "className">) {
  const { localization } = useAuth()
  const { supportEmailAddress, hasWebsite } = usePublicConfig()
  // The dialog lives outside the menu, which unmounts its items when it closes.
  const [supportOpen, setSupportOpen] = useState(false)
  return (
    <>
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
          // The website is served by a server rewrite, so leave the client router with a full page load.
          ...(hasWebsite
            ? [
                <DropdownMenuItem key="homepage" onClick={() => window.location.assign("/home")}>
                  <GlobeIcon className="text-muted-foreground" />
                  Homepage
                </DropdownMenuItem>,
              ]
            : []),
          <DropdownMenuItem key="contact-support" onClick={() => setSupportOpen(true)}>
            <LifebuoyIcon className="text-muted-foreground" />
            Contact Support
          </DropdownMenuItem>,
        ]}
        {...props}
      />
      <ContactSupportDialog
        open={supportOpen}
        onOpenChange={setSupportOpen}
        supportEmailAddress={supportEmailAddress}
      />
    </>
  )
}
