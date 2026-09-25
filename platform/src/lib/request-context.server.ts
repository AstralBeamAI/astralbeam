import { AsyncLocalStorage } from "node:async_hooks"
import type { NitroApp, NitroAppPlugin } from "nitro/types"

// Deno.serve's native fast path skips the per-request async context reset, leaking Better Auth stores.
// https://github.com/denoland/deno/blob/v2.9.7/ext/http/00_serve.ts#L919
const runInBootContext = AsyncLocalStorage.snapshot()

const requestContextPlugin = ((nitro: NitroApp) => {
  const { fetch } = nitro
  nitro.fetch = (request) => runInBootContext(fetch, request)
}) satisfies NitroAppPlugin

export default requestContextPlugin
