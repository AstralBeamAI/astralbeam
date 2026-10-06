import { createFileRoute } from "@tanstack/react-router"
import { ConversationsPage } from "@/components/conversations-page.tsx"

export const Route = createFileRoute("/conversations/")({
  component: ConversationsPage,
})
