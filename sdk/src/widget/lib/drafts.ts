export function storedThreadDraft(
  apiUrl: string,
  identity: string,
  threadId: string,
  text?: string,
): string {
  if (!identity) return ""
  const key = `astralbeam:draft:${JSON.stringify([apiUrl.replace(/\/+$/, ""), identity, threadId])}`
  try {
    if (text === undefined) return globalThis.localStorage?.getItem(key) ?? ""
    if (text) globalThis.localStorage?.setItem(key, text)
    else globalThis.localStorage?.removeItem(key)
  } catch {
    // Disabled or full browser storage must not prevent editing or sending.
  }
  return ""
}
