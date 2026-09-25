import { chatParamsFromRequestBody, toServerSentEventsResponse } from "@tanstack/ai"
import { createChatRun } from "@/lib/chat/run.server"
import type { ChatParams, ChatPrincipal } from "@/lib/chat/types"
import { restFault } from "../../-lib/responses.server"
import { readRequestJson, RequestTooLargeError } from "@/routes/api/-lib/request-body.server"
import { CHAT_MAX_REQUEST_BYTES } from "@/lib/chat/constants.server"

export async function runChatRequest(
  request: Request,
  principal: ChatPrincipal,
): Promise<Response> {
  let params: ChatParams
  try {
    params = await chatParamsFromRequestBody(await readRequestJson(request, CHAT_MAX_REQUEST_BYTES))
  } catch (error) {
    throw error instanceof RequestTooLargeError
      ? restFault(413, "The message and its attachments are too large.")
      : restFault(400, "The request body is not a valid chat run input.")
  }
  const { stream, abortController } = await createChatRun(params, principal)
  return toServerSentEventsResponse(stream, { abortController })
}
