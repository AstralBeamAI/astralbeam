import { afterEach, expect, test, vi } from "vitest"
import type { QueryClient } from "@tanstack/react-query"
import {
  claimListingQueryClient,
  clearListingCache,
  retainListingQueryClient,
} from "./query-cache.ts"

const clients: QueryClient[] = []
const claim: typeof claimListingQueryClient = (...args) => {
  const client = claimListingQueryClient(...args)
  clients.push(client)
  return client
}
afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.useRealTimers()
})

test("a returning directory reuses fresh results and reloads stale results", async () => {
  vi.useFakeTimers()
  const options = { cacheKey: {}, fetchAstralBeamToken: { url: "/token" } }
  const request = vi.fn().mockResolvedValue(["tenant"])
  const query = { queryKey: ["tenants"], queryFn: request }
  const first = claim(options, "tenants", "identity")
  await first.fetchQuery(query)
  retainListingQueryClient(options, "tenants", "identity", first)
  const returning = claim(options, "tenants", "identity")
  await expect(returning.fetchQuery(query)).resolves.toEqual(["tenant"])
  expect(request).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(30_001)
  await returning.fetchQuery(query)
  expect(request).toHaveBeenCalledTimes(2)
  retainListingQueryClient(options, "tenants", "identity", returning)
  vi.advanceTimersByTime(300_001)
  expect(claim(options, "tenants", "identity").getQueryData(["tenants"])).toBeUndefined()
})

test("concurrent views own their requests and retain separate results", async () => {
  const options = { cacheKey: {}, fetchAstralBeamToken: { url: "/token" } }
  const first = claim(options, "tenants", "identity")
  const second = claim(options, "tenants", "identity")
  let firstSignal: AbortSignal | undefined
  let secondSignal: AbortSignal | undefined
  const firstRequest = first.fetchQuery({
    queryKey: ["tenants"],
    queryFn: ({ signal }) => {
      firstSignal = signal
      return new Promise(() => {})
    },
  })
  const secondRequest = second.fetchQuery({
    queryKey: ["tenants"],
    queryFn: ({ signal }) => {
      secondSignal = signal
      return Promise.resolve(["second"])
    },
  })
  await Promise.all([expect(firstRequest).rejects.toThrow("CancelledError"), first.cancelQueries()])
  expect(firstSignal?.aborted).toBe(true)
  expect(secondSignal?.aborted).toBe(false)
  await expect(secondRequest).resolves.toEqual(["second"])
  const pinned = { ...options, tenantId: "other-tenant" }
  const users = claim(pinned, "users", "identity")
  users.setQueryData(["users"], ["other-user"])
  retainListingQueryClient(options, "tenants", "identity", second)
  retainListingQueryClient(pinned, "users", "identity", users)
  expect(claim(options, "tenants", "identity").getQueryData(["tenants"])).toEqual(["second"])
  expect(claim(pinned, "users", "identity").getQueryData(["users"])).toEqual(["other-user"])
})

test("identity changes and authentication failures discard retained data", () => {
  const options = { cacheKey: {}, fetchAstralBeamToken: { url: "/token" } }
  const old = claim(options, "tenants", "old-identity")
  old.setQueryData(["tenants"], ["private"])
  retainListingQueryClient(options, "tenants", "old-identity", old)
  const activeOldView = claim(options, "threads", "old-identity")
  activeOldView.setQueryData(["threads"], ["private-history"])
  const next = claim(options, "tenants", "new-identity")
  expect(next.getQueryData(["tenants"])).toBeUndefined()
  expect(old.getQueryData(["tenants"])).toBeUndefined()
  retainListingQueryClient(options, "threads", "old-identity", activeOldView)
  expect(activeOldView.getQueryData(["threads"])).toBeUndefined()
  expect(claim(options, "threads", "new-identity").getQueryData(["threads"])).toBeUndefined()
  next.setQueryData(["tenants"], ["new-private"])
  retainListingQueryClient(options, "tenants", "new-identity", next)
  clearListingCache(options.cacheKey)
  expect(claim(options, "tenants", "new-identity").getQueryData(["tenants"])).toBeUndefined()
})
