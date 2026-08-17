import { authClient } from "@astralbeam/auth/auth-client"
import { Button } from "@astralbeam/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@astralbeam/ui/components/card"
import { Input } from "@astralbeam/ui/components/input"
import { Spinner } from "@astralbeam/ui/components/spinner"
import { toast } from "@astralbeam/ui/components/toast"
import { SlugField } from "@astralbeam/ui/components/auth/organization/slug-field"
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  sanitizeOrganizationSlug,
} from "@astralbeam/ui/lib/auth/organization-slug"
import { useNavigate } from "@tanstack/react-router"
import { type ChangeEvent, type FormEvent, useState } from "react"

import { inferOrganizationName } from "@/lib/organization-name"

type OrganizationOnboardingProps = {
  email: string
}

export function OrganizationOnboarding({ email }: OrganizationOnboardingProps) {
  const navigate = useNavigate()
  const inferredOrganizationName = inferOrganizationName(email).slice(
    0,
    ORGANIZATION_NAME_MAX_LENGTH,
  )
  const [name, setName] = useState(inferredOrganizationName)
  const [editedSlug, setEditedSlug] = useState<string>()
  const [isPending, setIsPending] = useState(false)
  const slug = editedSlug ?? sanitizeOrganizationSlug(name)

  function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
    setName(event.target.value)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !slug) return

    setIsPending(true)
    const { error } = await authClient.organization.create({
      name: name.trim(),
      slug,
      keepCurrentActiveOrganization: false,
    })

    if (error) {
      toast.add({ title: error.message, type: "error" })
      setIsPending(false)
      return
    }

    await navigate({ to: "/dashboard", replace: true })
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create your organization</CardTitle>
        <CardDescription>
          Organizations are isolated AstralBeam workspaces for your team and data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="organization-name">
              Organization name
            </label>
            <Input
              aria-describedby="organization-name-description"
              autoComplete="organization"
              disabled={isPending}
              id="organization-name"
              maxLength={ORGANIZATION_NAME_MAX_LENGTH}
              onChange={handleNameChange}
              placeholder="Acme"
              required
              value={name}
            />
            <p className="text-xs text-muted-foreground" id="organization-name-description">
              {inferredOrganizationName
                ? "Suggested from your email domain. You can change it."
                : "Use your company or team name."}
            </p>
          </div>
          <SlugField
            authClient={authClient}
            disabled={isPending}
            id="organization-slug"
            onChange={setEditedSlug}
            value={slug}
          />
          <Button className="w-full" disabled={isPending} type="submit">
            {isPending ? <Spinner /> : null}
            Create organization
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
