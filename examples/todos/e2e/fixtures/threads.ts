export function savedUserMessage(id: string, content: string) {
  return {
    id,
    role: "user",
    state: "complete",
    parts: [{ id: "text", type: "text", content }],
  }
}

export function savedDirectoryMessages(
  thread: object,
  messages: object[],
  pageAfter: string | null = null,
) {
  return { thread, messages, page_after: pageAfter, page_before: null }
}
