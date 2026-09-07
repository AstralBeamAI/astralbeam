"use client"

import { useRouter } from "@tanstack/react-router"
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
  const [name, setName] = useState(organizationName)
  const [saving, setSaving] = useState(false)
  const normalizedName = name.trim()
  const valid = normalizedName.length > 0 && normalizedName.length <= ORGANIZATION_NAME_MAX_LENGTH

  const save = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || readOnly) return
    setSaving(true)
    try {
      await updateOrganizationSettings({ data: { organizationSlug, name: normalizedName } })
      toast.add({ title: "Organization saved", type: "success" })
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
            The display name appears throughout the dashboard; the slug addresses this organization
            everywhere else.
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
                value={organizationSlug}
                readOnly
                className="font-mono text-xs"
              />
              <FieldDescription>
                This organization's URL and the prefix of every agent ID and API key it issues, so
                it cannot be changed.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        {!readOnly && (
          <CardFooter className="justify-end">
            <Button
              type="submit"
              disabled={!valid || saving || normalizedName === organizationName}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}
