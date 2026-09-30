"use client"

import { useAuth } from "@better-auth-ui/react"
import {
  BriefcaseIcon,
  CubeIcon,
  HouseIcon,
  type Icon,
  IdentificationBadgeIcon,
  KeyIcon,
  RobotIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import type { Organization } from "better-auth/client"
import { type ComponentProps, useEffect } from "react"

import { OrganizationSwitcher } from "@/components/auth/organization/organization-switcher"
import { UserButton } from "@/components/auth/user/user-button"
// Load the Better Auth UI Link module augmentation used by useAuth().
import type {} from "@/components/auth/auth-provider"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import type { OrganizationAccess, OrganizationPermissions } from "@/lib/organizations/access"

type OrganizationNavigationEntry = {
  label: string
  segment: string
  icon: Icon
  permission?: keyof OrganizationPermissions
}

/** The sub-paths a switch carries over to the organization being switched to. */
const organizationNavigation = [
  { label: "Home", segment: "", icon: HouseIcon },
  { label: "Agents", segment: "agents", icon: RobotIcon, permission: "readConfiguration" },
  { label: "Sandboxes", segment: "sandboxes", icon: CubeIcon, permission: "readConfiguration" },
  { label: "API keys", segment: "api-keys", icon: KeyIcon, permission: "readApiKey" },
  { label: "Tenants", segment: "tenants", icon: BriefcaseIcon, permission: "readTenants" },
  {
    label: "Users",
    segment: "tenant-users",
    icon: UsersThreeIcon,
    permission: "readTenants",
  },
  { label: "Members", segment: "members", icon: IdentificationBadgeIcon },
  {
    label: "Settings",
    segment: "settings",
    icon: SlidersHorizontalIcon,
    permission: "updateOrganization",
  },
] satisfies readonly OrganizationNavigationEntry[]

const carriedSegments = new Set(
  organizationNavigation.map((entry) => entry.segment).filter(Boolean),
)

export type AppSidebarProps = Omit<ComponentProps<typeof Sidebar>, "children"> & {
  /** Null on the user-level settings pages of a user who has no organization yet. */
  organization: OrganizationAccess | null
}

function organizationPath(slug: string, segment: string): string {
  return segment ? `/${slug}/${segment}` : `/${slug}`
}

/** Keeps the visited section when its path exists under the organization being switched to. */
function organizationSwitchPath(pathname: string, currentSlug: string, nextSlug: string): string {
  const relative = pathname.startsWith(`/${currentSlug}/`)
    ? pathname.slice(currentSlug.length + 2)
    : ""
  const segment = relative.split("/")[0] ?? ""
  return carriedSegments.has(segment) ? `/${nextSlug}/${segment}` : `/${nextSlug}`
}

/** Sits in the navbar from the `md` breakpoint up, and in the sidebar header below it. */
export function AppOrganizationSwitcher({
  organization,
  className,
}: Pick<AppSidebarProps, "organization"> & { className: string }) {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { isMobile, setOpenMobile } = useSidebar()

  const switchOrganization = (next: Organization | null) => {
    setOpenMobile(false)
    if (!next?.slug) return
    void navigate({
      href: organization
        ? organizationSwitchPath(pathname, organization.organizationSlug, next.slug)
        : `/${next.slug}`,
    })
  }

  return (
    <OrganizationSwitcher
      align="start"
      size={isMobile ? "md" : "sm"}
      hidePersonal
      hideSettings
      {...(organization
        ? {
            organization: {
              id: organization.organizationId,
              name: organization.organizationName,
              slug: organization.organizationSlug,
            },
          }
        : {})}
      setActive={switchOrganization}
      onOrganizationCreated={(created) => void navigate({ href: `/${created.slug}` })}
      className={className}
    />
  )
}

export function AppSidebar({ organization, ...props }: AppSidebarProps) {
  const { Link, localization } = useAuth()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { isMobile, setOpenMobile } = useSidebar()

  useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])

  return (
    <Sidebar collapsible="icon" {...props}>
      {isMobile && (
        <SidebarHeader>
          <AppOrganizationSwitcher organization={organization} className="w-full justify-start" />
        </SidebarHeader>
      )}

      <SidebarContent>
        {organization && (
          <SidebarGroup>
            <SidebarGroupContent>
              <nav aria-label="Organization navigation">
                <SidebarMenu>
                  {organizationNavigation.map((item) => {
                    if (item.permission && !organization.permissions[item.permission]) return null
                    const href = organizationPath(organization.organizationSlug, item.segment)
                    const isActive =
                      item.segment === ""
                        ? pathname === href
                        : pathname === href || pathname.startsWith(`${href}/`)

                    return (
                      <SidebarMenuItem key={item.segment}>
                        <SidebarMenuButton
                          render={<Link href={href} onClick={() => setOpenMobile(false)} />}
                          isActive={isActive}
                          tooltip={item.label}
                          {...(isActive ? { "aria-current": "page" } : {})}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        {/* Only the collapsed rail shows the expand trigger, stacked above the avatar. Expanded, the
            rail's hover handle collapses the sidebar. */}
        <div className="flex items-center group-data-[collapsible=icon]:flex-col-reverse group-data-[collapsible=icon]:gap-1">
          <UserButton
            align="start"
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
            className="min-w-0 flex-1 justify-start group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>div>div]:hidden group-data-[collapsible=icon]:[&>svg]:hidden"
          />
          {!isMobile && (
            <SidebarTrigger className="hidden group-data-[collapsible=icon]:inline-flex" />
          )}
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
