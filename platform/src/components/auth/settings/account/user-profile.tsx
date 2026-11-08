// Added from @better-auth-ui/settings
// Local changes: name-only editing, Base UI Toast, typed profile helpers, navigation refresh, and local draft/error state.

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
import { cn } from "cn"

export type UserProfileProps = {
  className?: string
}

export function UserProfile({ className }: UserProfileProps) {
  const { authClient, localization } = useAuth()
  const { data: session } = useSession(authClient, { refetchOnMount: "always" })
  const [editedName, setEditedName] = useState<string>()

  const { mutate: updateUser, isPending } = useUpdateUser(authClient, {
    onSuccess: () => {
      setEditedName(undefined)
      toast.add({ title: localization.settings.profileUpdatedSuccess, type: "success" })
    },
  })

  const [nameError, setNameError] = useState<string>()

  function submitUserProfile(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()

    const formData = new FormData(e.currentTarget)
    const name = formData.get("name") as string
    updateUser({ name })
  }

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3">{localization.settings.userProfile}</h2>

      <form onSubmit={submitUserProfile}>
        <Card className={cn(className)}>
          <CardContent className="flex flex-col gap-6">
            <Field data-invalid={!!nameError}>
              <FieldLabel htmlFor="name">{localization.auth.name}</FieldLabel>

              {session ? (
                <Input
                  id="name"
                  name="name"
                  autoComplete="name"
                  value={editedName ?? session.user.name}
                  placeholder={localization.auth.name}
                  disabled={isPending}
                  required
                  onChange={(event) => {
                    setEditedName(event.currentTarget.value)
                    setNameError(undefined)
                  }}
                  onInvalid={(e) => {
                    e.preventDefault()

                    setNameError(e.currentTarget.validationMessage)
                  }}
                  aria-invalid={!!nameError}
                />
              ) : (
                <Skeleton>
                  <Input className="invisible" />
                </Skeleton>
              )}

              <FieldError>{nameError}</FieldError>
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
