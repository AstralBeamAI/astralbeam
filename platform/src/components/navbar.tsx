import { useSession } from "@better-auth-ui/react"
import { Link, useLocation } from "@tanstack/react-router"
import { createContext, type ReactNode, useContext } from "react"

import { ThemeToggle } from "@/components/theme-toggle"
import { buttonVariants } from "@/components/ui/button"
import { authClient } from "@/lib/auth/client"
import {
  APP_LOGO_DARK_SVG_URL,
  APP_LOGO_LIGHT_SVG_URL,
  APP_NAME,
  APP_WORDMARK_DARK_SVG_URL,
  APP_WORDMARK_LIGHT_SVG_URL,
} from "@/lib/constants"
import { cn } from "cn"

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
            <img src={APP_WORDMARK_LIGHT_SVG_URL} alt="" className="h-4.5 w-auto dark:hidden" />
            <img
              src={APP_WORDMARK_DARK_SVG_URL}
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

const crumbLinkClassName = cn(
  navLinkClassName,
  "text-muted-foreground aria-[current]:text-foreground",
)

export function DocsLink() {
  return (
    <Link to="/docs" className={navLinkClassName}>
      Docs
    </Link>
  )
}

/** Docs pages load without the auth providers, so their links leave through a full navigation. */
function AuthLinks({ reloadDocument = false }: { reloadDocument?: boolean }) {
  return (
    <>
      <Link
        to="/auth/$path"
        params={{ path: "sign-in" }}
        reloadDocument={reloadDocument}
        className={navLinkClassName}
      >
        Sign In
      </Link>
      <Link
        to="/auth/$path"
        params={{ path: "sign-up" }}
        reloadDocument={reloadDocument}
        className={cn(buttonVariants({ size: "sm" }), "ms-2.5")}
      >
        Sign Up
      </Link>
    </>
  )
}

export function DocsNavbar({ section }: { section?: { slug: string; title: string } | undefined }) {
  return (
    <Navbar
      reloadDocument
      wordmark
      crumbs={
        // Below `sm` the trail would crowd the links, and the logo alone leads home.
        <div className="hidden min-w-0 items-center gap-1 sm:flex">
          <NavbarCrumb>
            <Link to="/docs" activeOptions={{ exact: true }} className={crumbLinkClassName}>
              Docs
            </Link>
          </NavbarCrumb>
          {section && (
            <NavbarCrumb>
              <Link
                to="/docs/$section"
                params={{ section: section.slug }}
                className={cn(crumbLinkClassName, "min-w-0")}
              >
                <span className="truncate">{section.title}</span>
              </Link>
            </NavbarCrumb>
          )}
        </div>
      }
    >
      <a href="/" className={navLinkClassName}>
        Home
      </a>
      <AuthLinks reloadDocument />
    </Navbar>
  )
}

function SessionLinks() {
  const session = useSession(authClient)
  if (session.isPending) return null
  if (!session.data) return <AuthLinks />
  return (
    <Link to="/" className={navLinkClassName}>
      Home
    </Link>
  )
}

/** The navbar of pages outside the dashboard, which offers a signed-in visitor a way back home. */
export function PublicNavbar() {
  const underNavbar = useContext(UnderNavbarContext)
  const isDocs = useLocation({
    select: ({ pathname }) => pathname === "/docs" || pathname.startsWith("/docs/"),
  })
  if (underNavbar) return null
  if (isDocs) return <DocsNavbar />
  return (
    <Navbar wordmark>
      <DocsLink />
      <SessionLinks />
    </Navbar>
  )
}
