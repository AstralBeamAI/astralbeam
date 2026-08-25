// Added with: deno task ui add @better-auth-ui/settings
// Local changes: remove username and generic additional fields; use Base UI Toast and strict typing.

"use client"

import { useAuth, useSession, useUpdateUser } from "@better-auth-ui/react"
import { type SyntheticEvent, useState } from "react"
import { toast } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { ChangeAvatar } from "./change-avatar"

export type UserProfileProps = {
  className?: string
}

/**
 * Render a profile card that lets the authenticated user update their display name and avatar.
 *
 * @param className - Optional additional CSS class names applied to the card container
 * @returns A JSX element containing the profile card with avatar upload and an editable name field
 */
export function UserProfile({ className }: UserProfileProps) {
  const { authClient, localization } = useAuth()
  const { data: session } = useSession(authClient)

  const { mutate: updateUser, isPending } = useUpdateUser(authClient, {
    onSuccess: () =>
      toast.add({ title: localization.settings.profileUpdatedSuccess, type: "success" }),
  })

  const [fieldErrors, setFieldErrors] = useState<{
    name?: string | undefined
  }>({})

  function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()

    const formData = new FormData(e.currentTarget)
    const name = formData.get("name") as string
    updateUser({ name })
  }

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3">
        {localization.settings.userProfile}
      </h2>

      <form onSubmit={handleSubmit}>
        <Card className={cn(className)}>
          <CardContent className="flex flex-col gap-6">
            <ChangeAvatar />

            <Field data-invalid={!!fieldErrors.name}>
              <FieldLabel htmlFor="name">{localization.auth.name}</FieldLabel>

              {session
                ? (
                  <Input
                    key={session?.user.name}
                    id="name"
                    name="name"
                    autoComplete="name"
                    defaultValue={session?.user.name}
                    placeholder={localization.auth.name}
                    disabled={isPending}
                    required
                    onChange={() => {
                      setFieldErrors((prev) => ({
                        ...prev,
                        name: undefined,
                      }))
                    }}
                    onInvalid={(e) => {
                      e.preventDefault()

                      setFieldErrors((prev) => ({
                        ...prev,
                        name: (e.target as HTMLInputElement).validationMessage,
                      }))
                    }}
                    aria-invalid={!!fieldErrors.name}
                  />
                )
                : (
                  <Skeleton>
                    <Input className="invisible" />
                  </Skeleton>
                )}

              <FieldError>{fieldErrors.name}</FieldError>
            </Field>
          </CardContent>

          <CardFooter>
            <Button type="submit" size="sm" disabled={isPending || !session}>
              {isPending && <Spinner />}

              {localization.settings.saveChanges}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  )
}
