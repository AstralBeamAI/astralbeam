import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@astralbeam/ui/components/card"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_auth/dashboard/")({ component: DashboardIndex })

function DashboardIndex() {
  const { organization, user } = Route.useRouteContext()

  return (
    <section className="w-full space-y-6 p-4 md:p-6 lg:p-8">
      <header className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Overview</p>
        <h1 className="font-heading text-2xl font-medium tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Manage your organization and monitor your AstralBeam workspace.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your signed-in identity</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="font-medium">{user.name}</p>
            <p className="break-all text-muted-foreground">{user.email}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
            <CardDescription>Current workspace context</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="font-mono text-xs break-all">{organization.id}</p>
            <p className="text-muted-foreground">Switch organizations from the navigation.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
            <CardDescription>Your role in this organization</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-medium capitalize">{organization.role}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
