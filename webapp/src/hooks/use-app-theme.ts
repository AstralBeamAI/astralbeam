import { useCallback, useEffect, useState } from "react"

export const APP_THEMES = ["system", "light", "dark"] as const

type AppTheme = (typeof APP_THEMES)[number]
type ResolvedTheme = Exclude<AppTheme, "system">

const THEME_STORAGE_KEY = "theme"
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)"

function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === "string" && APP_THEMES.some((theme) => theme === value)
}

function resolveTheme(theme: AppTheme): ResolvedTheme {
  if (theme !== "system") return theme
  return globalThis.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light"
}

function applyTheme(theme: AppTheme) {
  const resolvedTheme = resolveTheme(theme)
  const root = globalThis.document.documentElement

  root.classList.toggle("dark", resolvedTheme === "dark")
  root.classList.toggle("light", resolvedTheme === "light")
  root.style.colorScheme = resolvedTheme
}

function readStoredTheme(): AppTheme {
  try {
    const storedTheme = globalThis.localStorage.getItem(THEME_STORAGE_KEY)
    return isAppTheme(storedTheme) ? storedTheme : "system"
  } catch {
    return "system"
  }
}

function persistTheme(theme: AppTheme) {
  try {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    return
  }
}

/**
 * Own the app theme without mutating server-rendered markup before hydration.
 * The initial `system` snapshot is identical on the server and client; stored
 * preferences are applied after hydration. https://react.dev/reference/react-dom/client/hydrateRoot#caveats
 */
export function useAppTheme() {
  const [theme, setThemeState] = useState<AppTheme>("system")

  useEffect(() => {
    applyTheme(theme)

    if (theme !== "system") return

    const systemTheme = globalThis.matchMedia(SYSTEM_DARK_QUERY)
    const handleSystemThemeChange = () => applyTheme("system")
    systemTheme.addEventListener("change", handleSystemThemeChange)
    return () => systemTheme.removeEventListener("change", handleSystemThemeChange)
  }, [theme])

  useEffect(() => {
    const storedTheme = readStoredTheme()
    applyTheme(storedTheme)
    setThemeState(storedTheme)

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return

      const nextTheme = isAppTheme(event.newValue) ? event.newValue : "system"
      applyTheme(nextTheme)
      setThemeState(nextTheme)
    }

    globalThis.addEventListener("storage", handleStorage)
    return () => globalThis.removeEventListener("storage", handleStorage)
  }, [])

  const setTheme = useCallback((nextTheme: string) => {
    if (!isAppTheme(nextTheme)) return

    applyTheme(nextTheme)
    persistTheme(nextTheme)
    setThemeState(nextTheme)
  }, [])

  return { setTheme, theme }
}
