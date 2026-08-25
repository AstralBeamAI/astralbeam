import { useSyncExternalStore } from "react"

const getDebug = () =>
  typeof location !== "undefined" && new URLSearchParams(location.search).has("debug")

const subscribeToDebug = () => () => undefined

export const useDebug = () => useSyncExternalStore(subscribeToDebug, getDebug, () => false)

export function toggleDebug() {
  if (typeof location === "undefined") return
  const params = new URLSearchParams(location.search)
  if (getDebug()) params.delete("debug")
  else params.set("debug", "")
  location.search = params.toString()
}
