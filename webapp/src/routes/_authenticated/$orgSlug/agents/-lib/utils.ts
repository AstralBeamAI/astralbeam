import { toast } from "@/components/ui/toast"

export async function copyAgentId(id: string): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(id)
    toast.add({ title: "Agent ID copied", type: "success" })
  } catch {
    toast.add({ title: "The agent ID could not be copied", type: "error" })
  }
}

export function agentRequestFailedToast(): void {
  toast.add({ title: "The agent request failed. Try again.", type: "error" })
}
