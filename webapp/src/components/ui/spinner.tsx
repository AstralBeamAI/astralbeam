// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Type forwarded props against the configured Phosphor icon for strict compatibility.

import { cn } from "@/lib/utils"
import { SpinnerIcon } from "@phosphor-icons/react"

function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof SpinnerIcon>) {
  return (
    <SpinnerIcon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
