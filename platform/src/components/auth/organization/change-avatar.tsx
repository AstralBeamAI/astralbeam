// Added with: deno task ui add @better-auth-ui/settings
// Local changes: use Phosphor icons and Base UI Toast, keep upload/cleanup errors non-sensitive, attach uploads immediately to the current membership, label the avatar action, and apply strict lint compatibility, including explicitly voided async handlers.

import { useAuth } from "@better-auth-ui/react"
import { TrashIcon as Trash2, UploadSimpleIcon as Upload } from "@phosphor-icons/react"
import { useRouter } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { type ChangeEvent, useRef, useState } from "react"
import { toast } from "@/components/ui/toast"
import { UserAvatar } from "@/components/auth/user/user-avatar"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "cn"
import { updateMemberAvatar } from "@/routes/_authenticated/$orgSlug/members/-functions/update-avatar"

export type ChangeAvatarProps = {
  className?: string
  organization: { organizationSlug: string; organizationName: string; avatarFileId: string | null }
}

export function ChangeAvatar({ className, organization }: ChangeAvatarProps) {
  const { localization, avatar } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isPending, setIsUploading] = useState(false)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    e.target.value = ""

    setIsUploading(true)

    try {
      const resized = (await avatar.resize?.(file, avatar.size, avatar.extension)) || file

      await updateMemberAvatar({
        data: {
          organizationSlug: organization.organizationSlug,
          bytes: new Uint8Array(await resized.arrayBuffer()),
        },
      })
      await Promise.all([router.invalidate(), queryClient.invalidateQueries()])
      toast.add({ title: localization.settings.avatarChangedSuccess, type: "success" })
    } catch {
      toast.add({
        title: "Your avatar could not be updated. Please try again.",
        type: "error",
      })
    }

    setIsUploading(false)
  }

  async function handleDelete() {
    setIsUploading(true)
    try {
      await updateMemberAvatar({
        data: { organizationSlug: organization.organizationSlug, bytes: null },
      })
      await Promise.all([router.invalidate(), queryClient.invalidateQueries()])
      toast.add({ title: localization.settings.avatarDeletedSuccess, type: "success" })
    } catch {
      toast.add({ title: "Your avatar could not be removed. Please try again.", type: "error" })
    }
    setIsUploading(false)
  }

  return (
    <Field className={className}>
      <FieldLabel>Your avatar for {organization.organizationName}</FieldLabel>
      <p className="text-sm text-muted-foreground">Only used in this Organization.</p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => void handleFileChange(e)}
      />

      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="ghost"
          className="p-0 h-auto w-auto rounded-full"
          aria-label={localization.settings.changeAvatar}
          title={localization.settings.changeAvatar}
          disabled={isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <UserAvatar className="size-12" isPending={isPending} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            disabled={isPending}
          >
            {isPending && <Spinner />}

            {localization.settings.changeAvatar}
          </DropdownMenuTrigger>

          <DropdownMenuContent className="min-w-fit">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="text-muted-foreground" />

              {localization.settings.uploadAvatar}
            </DropdownMenuItem>

            <DropdownMenuItem
              variant="destructive"
              disabled={!organization.avatarFileId}
              onClick={() => void handleDelete()}
            >
              <Trash2 />

              {localization.settings.deleteAvatar}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Field>
  )
}
