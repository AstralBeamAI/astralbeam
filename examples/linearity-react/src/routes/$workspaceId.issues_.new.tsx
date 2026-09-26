import { createFileRoute } from "@tanstack/react-router"
import { IssuePage } from "@/components/issue-page.tsx"
export const Route = createFileRoute("/$workspaceId/issues_/new")({ component: IssuePage })
