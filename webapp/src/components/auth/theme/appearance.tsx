// Added with: deno task ui add @better-auth-ui/theme
// Local changes: Replace Lucide with Phosphor icons, consume the static theme API directly, and label the theme radio group.

import {
  ThemePreviewDark,
  ThemePreviewLight,
  ThemePreviewSystem,
  useAuthPlugin,
} from "@better-auth-ui/react"
import { MonitorIcon as Monitor, MoonIcon as Moon, SunIcon as Sun } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldContent, FieldLabel, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { themePlugin } from "@/lib/auth/theme-plugin"
import { cn } from "@/lib/utils"

export type AppearanceProps = {
  className?: string
}

/**
 * Renders a theme selector card with visual theme previews.
 *
 * Displays a card containing radio buttons for selecting between system, light,
 * and dark themes. Each option shows a visual preview of the theme.
 *
 * @param className - Optional additional CSS class names for the card container.
 * @returns A JSX element containing the theme selector card.
 */
export function Appearance({ className }: AppearanceProps) {
  const { localization, setTheme, theme, themes = [] } = useAuthPlugin(themePlugin)

  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => setIsMounted(true), [])

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3">{localization.appearance}</h2>

      <Card className={cn(className)}>
        <CardContent>
          <Field>
            <FieldLabel id="appearance-theme-label">{localization.theme}</FieldLabel>

            <RadioGroup
              aria-labelledby="appearance-theme-label"
              value={isMounted ? theme : ""}
              onValueChange={setTheme}
              className="grid gap-3 grid-cols-2 sm:grid-cols-3"
              disabled={!isMounted || !theme}
            >
              {themes.includes("system") && (
                <FieldLabel htmlFor="system">
                  <Field orientation="horizontal">
                    <FieldContent className="gap-2">
                      <div className="flex items-center gap-2 justify-between">
                        <FieldTitle>
                          <Monitor className="size-4 text-muted-foreground" />

                          {localization.system}
                        </FieldTitle>

                        <RadioGroupItem value="system" id="system" />
                      </div>

                      <ThemePreviewSystem className="w-full" />
                    </FieldContent>
                  </Field>
                </FieldLabel>
              )}

              {themes.includes("light") && (
                <FieldLabel htmlFor="light">
                  <Field orientation="horizontal">
                    <FieldContent className="gap-2">
                      <div className="flex items-center gap-2 justify-between">
                        <FieldTitle>
                          <Sun className="size-4 text-muted-foreground" />

                          {localization.light}
                        </FieldTitle>

                        <RadioGroupItem value="light" id="light" />
                      </div>

                      <ThemePreviewLight className="w-full" />
                    </FieldContent>
                  </Field>
                </FieldLabel>
              )}

              {themes.includes("dark") && (
                <FieldLabel htmlFor="dark">
                  <Field orientation="horizontal">
                    <FieldContent className="gap-2">
                      <div className="flex items-center gap-2 justify-between">
                        <FieldTitle>
                          <Moon className="size-4 text-muted-foreground" />

                          {localization.dark}
                        </FieldTitle>

                        <RadioGroupItem value="dark" id="dark" />
                      </div>

                      <ThemePreviewDark className="w-full" />
                    </FieldContent>
                  </Field>
                </FieldLabel>
              )}
            </RadioGroup>
          </Field>
        </CardContent>
      </Card>
    </div>
  )
}
