"use client"

import { useNavigate, useRouter } from "@tanstack/react-router"
import { type SyntheticEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import {
  isReservedOrganizationSlug,
  RESERVED_ORGANIZATION_SLUG_MESSAGE,
} from "@/lib/auth/organization-slug"
import { isValidSlug, SLUG_MAX_LENGTH, SLUG_VALIDATION_MESSAGE } from "@/lib/slug"
import { updateOrganizationSettings } from "../-functions/update-organization-settings"

const ORGANIZATION_NAME_MAX_LENGTH = 100

export type OrganizationSettingsFormProps = {
  organizationSlug: string
  organizationName: string
  readOnly: boolean
}

export function OrganizationSettingsForm({
  organizationSlug,
  organizationName,
  readOnly,
}: OrganizationSettingsFormProps) {
  const router = useRouter()
  const navigate = useNavigate()
  const [name, setName] = useState(organizationName)
  const [slug, setSlug] = useState(organizationSlug)
  const [saving, setSaving] = useState(false)
  const normalizedName = name.trim()
  const normalizedSlug = slug.trim()
  const valid = normalizedName.length > 0 &&
    normalizedName.length <= ORGANIZATION_NAME_MAX_LENGTH &&
    isValidSlug(normalizedSlug) && !isReservedOrganizationSlug(normalizedSlug)

  const save = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || readOnly) return
    setSaving(true)
    try {
      const result = await updateOrganizationSettings({
        data: { organizationSlug, name: normalizedName, slug: normalizedSlug },
      })
      if (!result.ok) {
        toast.add({ title: result.message, type: "error" })
        return
      }
      toast.add({ title: "Organization saved", type: "success" })
      await navigate({
        to: "/$orgSlug/settings",
        params: { orgSlug: normalizedSlug },
        replace: true,
      })
      await router.invalidate()
    } catch {
      toast.add({ title: "The organization could not be saved. Try again.", type: "error" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            The display name appears throughout the dashboard. The slug is used only in URLs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="organization-name">Name</FieldLabel>
              <Input
                id="organization-name"
                value={name}
                required
                maxLength={ORGANIZATION_NAME_MAX_LENGTH}
                disabled={saving || readOnly}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="organization-slug">Slug</FieldLabel>
              <Input
                id="organization-slug"
                value={slug}
                required
                maxLength={SLUG_MAX_LENGTH}
                disabled={saving || readOnly}
                onChange={(event) => setSlug(event.target.value)}
                className="font-mono text-xs"
              />
              <FieldDescription>
                {!isValidSlug(normalizedSlug)
                  ? SLUG_VALIDATION_MESSAGE
                  : isReservedOrganizationSlug(normalizedSlug)
                  ? RESERVED_ORGANIZATION_SLUG_MESSAGE
                  : "Changing the slug breaks old URLs."}
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        {!readOnly && (
          <CardFooter className="justify-end">
            <Button
              type="submit"
              disabled={!valid || saving ||
                (normalizedName === organizationName && normalizedSlug === organizationSlug)}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}
