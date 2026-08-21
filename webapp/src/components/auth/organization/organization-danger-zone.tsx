import { useAuth } from "@better-auth-ui/react"
import type { ComponentProps } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { LeaveOrganization } from "./leave-organization"

export type OrganizationDangerZoneProps = {
  className?: string
}

/**
 * Danger zone heading with the guarded leave action. Organization deletion is disabled by product policy.
 */
export function OrganizationDangerZone({
  className,
  ...props
}: OrganizationDangerZoneProps & ComponentProps<"div">) {
  const { localization } = useAuth()

  return (
    <div className={cn("flex w-full flex-col", className)} {...props}>
      <h2 className="mb-3 text-sm font-semibold text-destructive">
        {localization.settings.dangerZone}
      </h2>

      <Card>
        <CardContent>
          <LeaveOrganization />
        </CardContent>
      </Card>
    </div>
  )
}
