import { createFileRoute } from "@tanstack/react-router"

import { TodosPage } from "@/components/todos-page.tsx"

export const Route = createFileRoute("/")({ component: TodosPage })
