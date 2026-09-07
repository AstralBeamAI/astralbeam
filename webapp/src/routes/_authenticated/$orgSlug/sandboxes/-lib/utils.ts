import { toast } from "@/components/ui/toast"

export function sandboxRequestFailedToast(): void {
  toast.add({
    title: "The request could not be completed",
    description: "Refresh and try again. Sensitive changes may require you to sign in again.",
    type: "error",
  })
}
