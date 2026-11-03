import { fileToBase64 } from "@better-auth-ui/core"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { ArrowsClockwiseIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import { useHydrated, useRouter } from "@tanstack/react-router"
import { type ChangeEvent, useRef, useState } from "react"

import { OrganizationLogo } from "@/components/auth/organization/organization-logo"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
      <div className="flex items-center gap-4" aria-busy={pending}>
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
                variant="ghost"
                className="p-0 h-auto w-auto rounded-full"
                aria-label="Change organization logo"
                disabled={controlsDisabled}
                onClick={() => fileInput.current?.click()}
              />
            }
          >
            <OrganizationLogo organization={organization} size="lg" />
          </TooltipTrigger>
          <TooltipContent>Change organization logo</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            disabled={controlsDisabled}
          >
            {pending && <Spinner />}
            Change logo
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-fit">
            <DropdownMenuItem onClick={() => fileInput.current?.click()}>
              <UploadSimpleIcon className="text-muted-foreground" />
              Upload logo
            </DropdownMenuItem>
            {!hasLogo && (
              <DropdownMenuItem onClick={() => void refreshLogo()}>
                <ArrowsClockwiseIcon className="text-muted-foreground" />
                Refresh logo from domain
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              disabled={!hasLogo}
              onClick={() => void saveLogo(null)}
            >
              <TrashIcon />
              Remove logo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <FieldDescription>
        PNG, JPEG, GIF, or WebP. Logo changes are saved immediately.
      </FieldDescription>
    </Field>
  )
}
