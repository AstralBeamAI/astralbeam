import { QueryClient } from "@tanstack/react-query"
import type { AstralBeamListingOptions } from "../../client/listings.ts"

interface ListingCache {
  identity: string
  clients: Map<string, QueryClient>
}

const caches = new WeakMap<object, ListingCache>()

export function createListingQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 30_000,
        gcTime: 300_000,
      },
    },
  })
}

function viewKey(options: AstralBeamListingOptions, kind: string) {
  return JSON.stringify([kind, options.scope ?? "tenant"])
}

export function clearListingCache(key: object | undefined) {
  if (!key) return
  for (const client of caches.get(key)?.clients.values() ?? []) client.clear()
  caches.delete(key)
}

export function claimListingQueryClient(
  options: AstralBeamListingOptions,
  kind: string,
  identity: string,
) {
  if (!options.cacheKey) return createListingQueryClient()
  let cache = caches.get(options.cacheKey)
  if (cache?.identity !== identity) {
    clearListingCache(options.cacheKey)
    cache = { identity, clients: new Map() }
    caches.set(options.cacheKey, cache)
  }
  const key = viewKey(options, kind)
  const client = cache.clients.get(key) ?? createListingQueryClient()
  // Active mounts own their sessions independently, even when they display the same view.
  cache.clients.delete(key)
  return client
}

export function retainListingQueryClient(
  options: AstralBeamListingOptions,
  kind: string,
  identity: string | undefined,
  client: QueryClient,
) {
  const cache = options.cacheKey && caches.get(options.cacheKey)
  if (!cache || cache.identity !== identity) return client.clear()
  const key = viewKey(options, kind)
  cache.clients.get(key)?.clear()
  cache.clients.set(key, client)
}
