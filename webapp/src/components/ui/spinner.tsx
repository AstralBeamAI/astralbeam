// Add with: deno task ui add spinner
// Local changes: use the Phosphor spinner with its native prop type.

import { cn } from "@/lib/utils"
import { SpinnerIcon } from "@phosphor-icons/react"
import type { ComponentProps } from "react"

function Spinner({ className, ...props }: ComponentProps<typeof SpinnerIcon>) {
  return (
    <SpinnerIcon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
