import { useSession } from "@better-auth-ui/react"
import { BookOpenTextIcon, HouseIcon } from "@phosphor-icons/react"
import { Link, useLocation } from "@tanstack/react-router"
import { createContext, type ReactNode, useContext } from "react"

import { ThemeToggle } from "@/components/theme-toggle"
import { buttonVariants } from "@/components/ui/button"
import { authClient } from "@/lib/auth/client"
import {
  APP_LOGO_DARK_SVG_URL,
  APP_LOGO_LIGHT_SVG_URL,
  APP_NAME,
  APP_WEBSITE_URL,
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
  logoTo?: "/" | "/docs"
  /** Shows the full wordmark from the `sm` breakpoint up, and the AB mark below it. */
  wordmark?: boolean
  start?: ReactNode
  children?: ReactNode
}

/** The full-width top bar every page renders, with its links and the theme toggle at the end. */
export function Navbar({ logoTo = "/", wordmark = false, start, children }: NavbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
      {start}
      <Link to={logoTo} aria-label={`${APP_NAME} home`} className="flex shrink-0 items-center">
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
      <nav aria-label="Main" className="ms-auto flex items-center gap-1">
        {children}
        <ThemeToggle />
      </nav>
    </header>
  )
}

export function DocsLink() {
  return (
    <Link to="/docs" className={navLinkClassName}>
      <BookOpenTextIcon aria-hidden="true" data-icon="inline-start" />
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
        className={buttonVariants({ size: "sm" })}
      >
        Sign Up
      </Link>
    </>
  )
}

export function DocsNavbar() {
  return (
    <Navbar logoTo="/docs" wordmark>
      <a href={APP_WEBSITE_URL} className={navLinkClassName}>
        <HouseIcon aria-hidden="true" data-icon="inline-start" />
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
      <HouseIcon aria-hidden="true" data-icon="inline-start" />
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
