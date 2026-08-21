import type { chatParamsFromRequest } from "@tanstack/ai"

export type ChatParams = Awaited<ReturnType<typeof chatParamsFromRequest>>
export type ChatMessages = ChatParams["messages"]

export type DebugLog = (category: string, summary: string, data?: unknown) => void
