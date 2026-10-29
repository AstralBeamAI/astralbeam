import { useSession } from "@better-auth-ui/react"
import { Link, useLocation } from "@tanstack/react-router"
import { createContext, type ReactNode, useContext } from "react"

import { useHasWebsite } from "@/components/public-config-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { buttonVariants } from "@/components/ui/button"
import { WebsiteLink } from "@/components/website-link"
import { authClient } from "@/lib/auth/client"
import { normalizeReturnPathFromSearch } from "@/lib/auth/redirect"
import {
  APP_LOGO_DARK_SVG_URL,
  APP_LOGO_LIGHT_SVG_URL,
  APP_NAME,
  APP_WORDMARK_DARK_SVG_URL,
  APP_WORDMARK_LIGHT_SVG_URL,
  AUTH_ALLOWED_RETURN_PATHS,
  INERT_REDIRECT_ORIGIN,
} from "@/lib/constants"
import { cn } from "cn"
import { useIsSignedIn } from "@website/lib/use-is-signed-in"

const navLinkClassName = buttonVariants({ variant: "ghost", size: "sm" })
const UnderNavbarContext = createContext(false)

/** Marks a layout's page as already under a navbar, so its fallback pages render none of their own. */
export function UnderNavbar({ children }: { children: ReactNode }) {
  return <UnderNavbarContext.Provider value>{children}</UnderNavbarContext.Provider>
}

type NavbarProps = {
  /** Leaves through a full navigation, for pages that load without the auth providers. */
  reloadDocument?: boolean
  /** Shows the full wordmark from the `sm` breakpoint up, and the AB mark below it. */
  wordmark?: boolean
  start?: ReactNode
  /** `NavbarCrumb` segments after the logo, in a container that picks its own breakpoint. */
  crumbs?: ReactNode
  children?: ReactNode
}

/** The full-width top bar every page renders, with its links and the theme toggle at the end. */
export function Navbar({
  reloadDocument = false,
  wordmark = false,
  start,
  crumbs,
  children,
}: NavbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
      {start}
      <Link
        to="/"
        reloadDocument={reloadDocument}
        aria-label={`${APP_NAME} home`}
        className="flex shrink-0 items-center"
      >
        <span className={cn("contents", wordmark && "sm:hidden")}>
          <img src={APP_LOGO_LIGHT_SVG_URL} alt="" className="size-8 dark:hidden" />
          <img src={APP_LOGO_DARK_SVG_URL} alt="" className="hidden size-8 dark:block" />
        </span>
        {wordmark && (
          <span className="hidden sm:contents">
            <img
              src={APP_WORDMARK_LIGHT_SVG_URL}
              width={1241}
              height={136}
              alt=""
              className="h-4.5 w-auto dark:hidden"
            />
            <img
              src={APP_WORDMARK_DARK_SVG_URL}
              width={1241}
              height={136}
              alt=""
              className="hidden h-4.5 w-auto dark:block"
            />
          </span>
        )}
      </Link>
      {crumbs}
      {/* The margins even out the visible gaps beside the toggle icon and the boxed buttons. */}
      <nav aria-label="Main" className="ms-auto flex items-center gap-1">
        <ThemeToggle className="me-1" />
        {children}
      </nav>
    </header>
  )
}

/** A `/`-led segment after the navbar logo. */
export function NavbarCrumb({ children }: { children: ReactNode }) {
  return (
    <>
      <span aria-hidden="true" className="px-1 text-muted-foreground">
        /
      </span>
      {children}
    </>
  )
}

export function NavbarDocsLink() {
  return (
    <Link to="/docs" className={navLinkClassName}>
      Docs
    </Link>
  )
}

function DashboardLink({ reloadDocument = false }: { reloadDocument?: boolean }) {
  return (
    <Link
      to="/"
      reloadDocument={reloadDocument}
      className={cn(buttonVariants({ size: "sm" }), "ms-2.5")}
    >
      Dashboard
    </Link>
  )
}

/** Docs pages load without the auth providers, so their links leave through a full navigation. */
function AuthLinks({ reloadDocument = false }: { reloadDocument?: boolean }) {
  const redirectTo = useLocation({
    select: ({ searchStr }) =>
      normalizeReturnPathFromSearch(searchStr, INERT_REDIRECT_ORIGIN, AUTH_ALLOWED_RETURN_PATHS),
  })
  return (
    <>
      <Link
        to="/auth/$path"
        params={{ path: "sign-in" }}
        search={{ redirectTo }}
        reloadDocument={reloadDocument}
        className={navLinkClassName}
      >
        Sign In
      </Link>
      <Link
        to="/auth/$path"
        params={{ path: "sign-up" }}
        search={{ redirectTo }}
        reloadDocument={reloadDocument}
        className={cn(buttonVariants({ size: "sm" }), "ms-2.5")}
      >
        Sign Up
      </Link>
    </>
  )
}

export function DocsNavbar({
  section,
}: {
  section?: { slug: string; title: string; href?: string } | undefined
}) {
  const signedIn = useIsSignedIn()
  // Scalar replaces router history state, so leave its document on navigation.
  // https://github.com/scalar/scalar/blob/545bab57b0b18d8811504389396953f60a354443/packages/api-reference/src/components/ApiReference.vue#L1701
  const reloadDocument = Boolean(section?.href)
  return (
    <Navbar
      reloadDocument
      wordmark
      crumbs={
        // Below `sm` the trail would crowd the links, and the logo alone leads home.
        <div className="hidden min-w-0 items-center gap-1 sm:flex">
          <NavbarCrumb>
            <Link
              to="/docs"
              reloadDocument={reloadDocument}
              activeOptions={{ exact: true }}
              className={navLinkClassName}
            >
              Docs
            </Link>
          </NavbarCrumb>
          {section && (
            <NavbarCrumb>
              <Link
                {...(section.href
                  ? { to: section.href }
                  : { to: "/docs/$section", params: { section: section.slug } })}
                reloadDocument={reloadDocument}
                className={cn(navLinkClassName, "min-w-0")}
              >
                <span className="truncate">{section.title}</span>
              </Link>
            </NavbarCrumb>
          )}
        </div>
      }
    >
      <WebsiteLink className={navLinkClassName}>Website</WebsiteLink>
      {signedIn ? <DashboardLink reloadDocument /> : <AuthLinks reloadDocument />}
    </Navbar>
  )
}

function SessionLinks() {
  const session = useSession(authClient)
  if (session.isPending) return null
  if (!session.data) return <AuthLinks />
  return <DashboardLink />
}

/** The navbar of pages outside the dashboard, which offers a signed-in visitor a way back home. */
export function PublicNavbar() {
  const underNavbar = useContext(UnderNavbarContext)
  const hasWebsite = useHasWebsite()
  const isDocs = useLocation({
    select: ({ pathname }) => pathname === "/docs" || pathname.startsWith("/docs/"),
  })
  if (underNavbar) return null
  if (isDocs) return <DocsNavbar />
  return (
    <Navbar wordmark reloadDocument={hasWebsite}>
      <NavbarDocsLink />
      <SessionLinks />
    </Navbar>
  )
}
