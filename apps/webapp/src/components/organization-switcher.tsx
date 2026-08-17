import { authClient } from "@astralbeam/auth/auth-client"
import { OrganizationSwitcher as OrganizationSwitcherView } from "@astralbeam/ui/components/auth/organization/organization-switcher"
import { useRouter } from "@tanstack/react-router"

type OrganizationSwitcherControlProps = {
  align?: "center" | "end" | "start"
  className?: string
  hideSlug?: boolean
  side?: "bottom" | "left" | "right" | "top"
}

export function OrganizationSwitcherControl({
  align = "end",
  className,
  hideSlug,
  side,
}: OrganizationSwitcherControlProps) {
  const router = useRouter()

  return (
    <OrganizationSwitcherView
      align={align}
      authClient={authClient}
      className={className}
      hideSlug={hideSlug}
      onActiveChange={router.invalidate}
      side={side}
    />
  )
}
