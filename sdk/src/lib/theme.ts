import { DEFAULT_COLOR_SCHEME } from "./constants.ts"
import type { AstralBeamChatColorScheme, AstralBeamChatTheme } from "./types.ts"

export function applyWidgetTheme(
  container: HTMLElement,
  variables: Set<string>,
  options: {
    colorScheme?: AstralBeamChatColorScheme | undefined
    theme?: AstralBeamChatTheme | undefined
  },
  systemDark: boolean,
) {
  const colorScheme = options.colorScheme ?? DEFAULT_COLOR_SCHEME
  const dark = colorScheme === "dark" || (colorScheme === "system" && systemDark)
  container.classList.toggle("dark", dark)
  for (const name of variables) container.style.removeProperty(name)
  variables.clear()
  // Light overrides are the base in both schemes, matching shadcn's root/dark token cascade.
  const overrides = { ...options.theme?.light, ...(dark ? options.theme?.dark : undefined) }
  for (const [name, value] of Object.entries(overrides)) {
    if (!name.startsWith("--")) continue
    container.style.setProperty(name, value)
    variables.add(name)
  }
  return { colorScheme, dark }
}
