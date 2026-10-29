import { fileToBase64 } from "@better-auth-ui/core"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { ArrowsClockwiseIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import { useHydrated, useRouter } from "@tanstack/react-router"
import { type ChangeEvent, useRef, useState } from "react"

import { OrganizationLogo } from "@/components/auth/organization/organization-logo"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { authClient } from "@/lib/auth/client"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { refreshOrganizationLogo } from "../-functions/refresh-organization-logo"

export function OrganizationLogoControls({
  organization,
  organizationSlug,
  disabled,
}: {
  organization: { id: string; name: string; logoFileId: string | null }
  organizationSlug: string
  disabled: boolean
}) {
  const { avatar } = useAuth()
  const { logo } = useAuthPlugin(organizationPlugin)
  const router = useRouter()
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const controlsDisabled = !hydrated || disabled || pending
  const hasLogo = organization.logoFileId !== null

  async function saveLogo(file: File | null) {
    setPending(true)
    try {
      const resized = file ? (await avatar.resize?.(file, logo.size, logo.extension)) || file : null
      const { error } = await authClient.organization.update({
        organizationId: organization.id,
        data: { logo: resized ? await fileToBase64(resized) : null },
      })
      if (error) throw new Error("Organization logo update failed")
      await Promise.all([router.invalidate(), queryClient.invalidateQueries()])
      toast.add({
        title: file ? "Organization logo uploaded" : "Organization logo removed",
        type: "success",
      })
    } catch {
      toast.add({
        title: "The organization logo could not be updated. Please try again.",
        type: "error",
      })
    } finally {
      setPending(false)
    }
  }

  function selectLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) void saveLogo(file)
  }

  async function refreshLogo() {
    setPending(true)
    try {
      await refreshOrganizationLogo({ data: { organizationSlug } })
      toast.add({ title: "Logo refresh requested", type: "success" })
    } catch {
      toast.add({ title: "Logo refresh could not be requested. Please try again.", type: "error" })
    } finally {
      setPending(false)
    }
  }

  return (
    <Field>
      <FieldLabel>Organization logo</FieldLabel>
      <div className="flex items-center gap-3" aria-busy={pending}>
        <OrganizationLogo organization={organization} size="lg" />
        <input
          ref={fileInput}
          type="file"
          aria-label="Organization logo file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          disabled={controlsDisabled}
          onChange={selectLogo}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Upload organization logo"
                disabled={controlsDisabled}
                onClick={() => fileInput.current?.click()}
              />
            }
          >
            {pending ? <Spinner /> : <UploadSimpleIcon />}
          </TooltipTrigger>
          <TooltipContent>Upload logo</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={hasLogo ? "Remove organization logo" : "Refresh organization logo"}
                disabled={controlsDisabled}
                onClick={() => void (hasLogo ? saveLogo(null) : refreshLogo())}
              />
            }
          >
            {hasLogo ? <TrashIcon /> : <ArrowsClockwiseIcon />}
          </TooltipTrigger>
          <TooltipContent>{hasLogo ? "Remove logo" : "Refresh logo"}</TooltipContent>
        </Tooltip>
      </div>
      <FieldDescription>
        PNG, JPEG, GIF, or WebP. Logo changes are saved immediately.
      </FieldDescription>
    </Field>
  )
}
