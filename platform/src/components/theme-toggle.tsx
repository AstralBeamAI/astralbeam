import { MoonIcon, SunIcon } from "@phosphor-icons/react"
import { useTheme } from "tanstack-router-theme-provider"

import { Button } from "@/components/ui/button"

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()

  // The icons follow the root `dark` class, so server markup matches before the theme resolves.
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label="Toggle theme"
      title="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon className="hidden dark:block" />
      <MoonIcon className="dark:hidden" />
    </Button>
  )
}
