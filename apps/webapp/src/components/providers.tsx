import { authClient } from "@astralbeam/auth/auth-client"
import { AuthProvider } from "@astralbeam/ui/components/auth/auth-provider"
import { Toaster } from "@astralbeam/ui/components/toast"
import { organizationPlugin } from "@astralbeam/ui/lib/auth/organization-plugin"
import { Link, useNavigate } from "@tanstack/react-router"

const emailAndPassword = { enabled: false }
const socialProviders: ("github" | "google")[] = ["google", "github"]
const authPlugins = [organizationPlugin()]

type AuthLinkProps = React.PropsWithChildren<
  { className?: string; href: string; to?: string } & Pick<
    React.ComponentPropsWithoutRef<"a">,
    "aria-disabled" | "onClick" | "tabIndex"
  >
>

function AuthLink({ href, ...props }: AuthLinkProps) {
  return <Link to={href} {...props} />
}

export function Providers({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()

  return (
    <AuthProvider
      authClient={authClient}
      emailAndPassword={emailAndPassword}
      Link={AuthLink}
      navigate={navigate}
      plugins={authPlugins}
      redirectTo="/dashboard"
      socialProviders={socialProviders}
    >
      {children}
      <Toaster />
    </AuthProvider>
  )
}
