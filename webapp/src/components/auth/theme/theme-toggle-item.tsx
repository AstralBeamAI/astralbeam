// Added with: deno task ui add @better-auth-ui/theme
// Local changes: Replace Lucide with Phosphor icons, consume the static theme API directly, and use a semantic radio submenu instead of nesting tabs inside a menu item.

"use client"

import { useAuthPlugin } from "@better-auth-ui/react"
import {
  MonitorIcon as Monitor,
  MoonIcon as Moon,
  PaletteIcon,
  SunIcon as Sun,
} from "@phosphor-icons/react"
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { themePlugin } from "@/lib/auth/theme-plugin"

/**
 * Theme toggle dropdown item used inside `UserButton`. Callers are responsible
 * for ensuring theming is configured before rendering this component.
 */
export function ThemeToggleItem() {
  const { localization, setTheme, theme, themes = [] } = useAuthPlugin(themePlugin)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <PaletteIcon className="text-muted-foreground" />
        {localization.theme}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (typeof value === "string" && themes.includes(value)) {
              setTheme(value)
            }
          }}
        >
          {themes.includes("system") && (
            <DropdownMenuRadioItem value="system">
              <Monitor />
              {localization.system}
            </DropdownMenuRadioItem>
          )}
          {themes.includes("light") && (
            <DropdownMenuRadioItem value="light">
              <Sun />
              {localization.light}
            </DropdownMenuRadioItem>
          )}
          {themes.includes("dark") && (
            <DropdownMenuRadioItem value="dark">
              <Moon />
              {localization.dark}
            </DropdownMenuRadioItem>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
