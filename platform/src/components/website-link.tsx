import type { ComponentProps } from "react"

export function WebsiteLink({ children, ...props }: ComponentProps<"a">) {
  return (
    <a {...props} href="https://astralbeam.ai/home" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}
