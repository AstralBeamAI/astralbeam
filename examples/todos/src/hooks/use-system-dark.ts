import { useSyncExternalStore } from "react"

const getSystemDark = () =>
  typeof matchMedia === "undefined" ? false : matchMedia("(prefers-color-scheme: dark)").matches

const subscribeToSystemDark = (onChange: () => void) => {
  if (typeof matchMedia === "undefined") return () => undefined
  const systemDark = matchMedia("(prefers-color-scheme: dark)")
  systemDark.addEventListener("change", onChange)
  return () => systemDark.removeEventListener("change", onChange)
}

export const useSystemDark = () =>
  useSyncExternalStore(subscribeToSystemDark, getSystemDark, () => false)
