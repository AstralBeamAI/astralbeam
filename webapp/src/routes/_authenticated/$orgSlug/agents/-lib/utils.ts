import { toast } from "@/components/ui/toast"

export function agentPublicId(organizationSlug: string, agentSlug: string): string {
  return `agt_${organizationSlug}_${agentSlug}`
}

export async function copyAgentPublicId(publicId: string): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(publicId)
    toast.add({ title: "Agent ID copied", type: "success" })
  } catch {
    toast.add({ title: "The agent ID could not be copied", type: "error" })
  }
}

export function agentRequestFailedToast(): void {
  toast.add({ title: "The agent request failed. Try again.", type: "error" })
}
