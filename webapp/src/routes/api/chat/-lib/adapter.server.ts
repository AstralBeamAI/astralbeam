import { OpenAITextAdapter } from "@tanstack/ai-openai"

import type { ModelMessage } from "@tanstack/ai"

/** Model every chat run streams from. */
const CHAT_MODEL = "gpt-5.6-terra"

/**
 * Chat adapter that replays a completed tool call by `call_id` alone.
 *
 * The base adapter captures each `function_call`'s Responses item id from the stream and replays it
 * as `id` on the following request, but never replays the `reasoning` item the call was paired with.
 * A reasoning model rejects that pairing with "Item 'fc_...' of type 'function_call' was provided
 * without its required 'reasoning' item", which fails the run the moment a host tool result comes
 * back and leaves the widget with no reply. Dropping the item id makes the call match on `call_id`,
 * which carries no reasoning requirement.
 *
 * https://platform.openai.com/docs/guides/reasoning#keeping-reasoning-items-in-context
 */
class ChatAdapter extends OpenAITextAdapter<typeof CHAT_MODEL> {
  // The return type is inherited: `openai` is not a direct dependency, so its `ResponseInput`
  // cannot be named here, and dropping an optional property keeps each item's own type.
  protected override convertMessagesToInput(messages: Array<ModelMessage>) {
    return super.convertMessagesToInput(messages).map((item) => {
      if (!("type" in item) || item.type !== "function_call" || !("id" in item)) return item
      const { id: _itemId, ...withoutItemId } = item
      return withoutItemId as typeof item
    })
  }
}

export function createChatAdapter(apiKey: string) {
  return new ChatAdapter({ apiKey }, CHAT_MODEL)
}
