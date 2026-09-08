import { chatParamsFromRequestBody, toServerSentEventsResponse } from "@tanstack/ai"
import { createChatRun } from "@/lib/chat/run.server"
import type { ChatParams, ChatPrincipal } from "@/lib/chat/types"
import { restFault } from "../../-lib/responses.server"
import { ChatRequestTooLargeError, readChatRequestJson } from "./utils.server"

export async function runChatRequest(
  request: Request,
  principal: ChatPrincipal,
): Promise<Response> {
  let params: ChatParams
  try {
    params = await chatParamsFromRequestBody(await readChatRequestJson(request))
  } catch (error) {
    throw error instanceof ChatRequestTooLargeError
      ? restFault(413, "The message and its attachments are too large.")
      : restFault(400, "The request body is not a valid chat run input.")
  }
  const { stream, abortController } = await createChatRun(params, principal)
  return toServerSentEventsResponse(stream, { abortController })
}
