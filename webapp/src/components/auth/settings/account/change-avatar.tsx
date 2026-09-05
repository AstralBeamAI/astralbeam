// Added with: deno task ui add @better-auth-ui/settings
// Local changes: use Phosphor icons and Base UI Toast, keep upload/cleanup errors non-sensitive, preserve database success when remote cleanup fails, label the avatar action, and apply strict lint compatibility.

import { fileToAvatarDataUrl } from "@better-auth-ui/core"
import { useAuth, useSession, useUpdateUser } from "@better-auth-ui/react"
import { TrashIcon as Trash2, UploadSimpleIcon as Upload } from "@phosphor-icons/react"
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

export type ChangeAvatarProps = {
  className?: string
}

export function ChangeAvatar({ className }: ChangeAvatarProps) {
  const { authClient, localization, avatar } = useAuth()
  const { data: session } = useSession(authClient)

  const { mutate: updateUser, isPending: updatePending } = useUpdateUser(authClient)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const isPending = updatePending || isUploading || isDeleting

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    e.target.value = ""

    setIsUploading(true)

    try {
      const resized = (await avatar.resize?.(file, avatar.size, avatar.extension)) || file

      const image = (await avatar.upload?.(resized)) || (await fileToAvatarDataUrl(resized))

      updateUser(
        { image },
        {
          onSuccess: () =>
            toast.add({ title: localization.settings.avatarChangedSuccess, type: "success" }),
        },
      )
    } catch {
      toast.add({
        title: "Your avatar could not be updated. Please try again.",
        type: "error",
      })
    }

    setIsUploading(false)
  }

  function handleDelete() {
    const currentImage = session?.user.image

    updateUser(
      { image: null },
      {
        onSuccess: async () => {
          let cleanupFailed = false
          if (currentImage) {
            setIsDeleting(true)
            try {
              await avatar.delete?.(currentImage)
            } catch {
              cleanupFailed = true
            } finally {
              setIsDeleting(false)
            }
          }

          toast.add({
            title: cleanupFailed
              ? "Your avatar was removed, but its previous file could not be deleted."
              : localization.settings.avatarDeletedSuccess,
            type: cleanupFailed ? "warning" : "success",
          })
        },
      },
    )
  }

  return (
    <Field className={className}>
      <FieldLabel>{localization.settings.avatar}</FieldLabel>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
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
            disabled={!session || isPending}
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
              disabled={!session?.user.image}
              onClick={handleDelete}
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
