import { useQueryClient } from "@tanstack/react-query"
import { useServerFn } from "@tanstack/react-start"
import { UserPlus } from "@phosphor-icons/react"
import { type SyntheticEvent, useState } from "react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { addOrganizationAccess } from "@/server/organization-access.functions"

export interface AddOrganizationAccessDialogProps {
  isOwner: boolean
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function AddOrganizationAccessDialog({
  isOwner,
  onOpenChange,
  open,
}: AddOrganizationAccessDialogProps) {
  const addAccess = useServerFn(addOrganizationAccess)
  const queryClient = useQueryClient()
  const [emailError, setEmailError] = useState<string>()
  const [isPending, setIsPending] = useState(false)
  const [requestedRole, setRequestedRole] = useState<"member" | "admin">("member")

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const email = new FormData(form).get("email")
    if (typeof email !== "string") return

    setIsPending(true)
    try {
      const result = await addAccess({ data: { email: email.trim(), requestedRole } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organization-access"] }),
        queryClient.invalidateQueries({ queryKey: ["auth"] }),
      ])
      onOpenChange(false)
      form.reset()
      toast.success(
        result.result === "pending"
          ? "Access will activate on sign-in when capacity is available"
          : result.result === "added"
          ? "Member added to the organization"
          : result.result === "updated"
          ? "Member role updated"
          : "This user is already a member",
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update access")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              <UserPlus /> Add organization access
            </DialogTitle>
            <DialogDescription>
              Existing accounts join immediately. Otherwise access remains pending until a verified
              sign-in and organization capacity are available.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field data-invalid={!!emailError}>
              <FieldLabel htmlFor="organization-access-email">Email</FieldLabel>
              <Input
                autoComplete="email"
                autoFocus
                disabled={isPending}
                id="organization-access-email"
                name="email"
                onChange={() => setEmailError(undefined)}
                onInvalid={(event) => {
                  event.preventDefault()
                  setEmailError("Enter a valid email address")
                }}
                placeholder="person@example.com"
                required
                type="email"
              />
              <FieldError>{emailError}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="organization-access-role">Role</FieldLabel>
              <Select
                disabled={isPending}
                items={isOwner
                  ? [{ label: "Member", value: "member" }, { label: "Admin", value: "admin" }]
                  : [{ label: "Member", value: "member" }]}
                onValueChange={(value) => setRequestedRole(value === "admin" ? "admin" : "member")}
                value={requestedRole}
              >
                <SelectTrigger className="w-full" id="organization-access-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="member">Member</SelectItem>
                    {isOwner ? <SelectItem value="admin">Admin</SelectItem> : null}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              disabled={isPending}
              type="button"
            >
              Cancel
            </DialogClose>
            <Button disabled={isPending} type="submit">
              {isPending ? <Spinner /> : null} Add access
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
