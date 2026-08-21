import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowRight, Building, UserPlus, Users } from "@phosphor-icons/react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/_authenticated/_organization/dashboard/")({
  component: DashboardPage,
})

function DashboardPage() {
  const { session } = Route.useRouteContext()

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 p-6 py-10">
      <div className="space-y-2">
        <p className="text-sm font-medium text-primary">Organization workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back, {session.user.name}</h1>
        <p className="text-muted-foreground">
          Manage your organization and provision access without sending invitation email.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <FeatureCard
          icon={Building}
          title="Organization settings"
          description="Update the organization profile and switch workspaces."
          path="settings"
        />
        <FeatureCard
          icon={Users}
          title="Members"
          description="Review active owners, admins, and members."
          path="people"
        />
        <FeatureCard
          icon={UserPlus}
          title="Provision access"
          description="Add existing users immediately or stage access for signup."
          path="people"
        />
      </div>
    </main>
  )
}

function FeatureCard({
  description,
  icon: Icon,
  path,
  title,
}: {
  description: string
  icon: typeof Building
  path: "people" | "settings"
  title: string
}) {
  return (
    <Card>
      <CardHeader>
        <Icon className="size-5 text-primary" />
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          aria-label={`Open ${title}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary"
          to="/organization/$path"
          params={{ path }}
        >
          Open <ArrowRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
