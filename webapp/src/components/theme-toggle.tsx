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
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
] as const

function isThemeToggleValue(
  value: unknown,
): value is (typeof themeToggleOptions)[number]["value"] {
  return themeToggleOptions.some((option) => option.value === value)
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, mounted } = useTheme()
  const current = mounted ? theme : "system"
  const CurrentIcon = themeToggleOptions.find((option) => option.value === current)?.icon ??
    MonitorIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), className)}
        aria-label="Theme"
        title="Theme"
      >
        <CurrentIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={current}
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
