import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react"
import { useTheme } from "tanstack-router-theme-provider"

import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "cn"

const themeToggleOptions = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const

function isThemeToggleValue(value: unknown): value is (typeof themeToggleOptions)[number]["value"] {
  return themeToggleOptions.some((option) => option.value === value)
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()

  // The icons follow the root `dark` class, so server markup matches before the theme resolves.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), className)}
        aria-label="Theme"
        title="Theme"
      >
        <SunIcon className="dark:hidden" />
        <MoonIcon className="hidden dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isThemeToggleValue(value)) setTheme(value)
          }}
        >
          {themeToggleOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
