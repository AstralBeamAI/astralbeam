// Added with: deno task ui add spinner
import { cn } from "cn"
import { SpinnerIcon } from "@phosphor-icons/react"

// Typed from the icon rather than "svg" so the spread satisfies exactOptionalPropertyTypes.
function Spinner({ className, ...props }: React.ComponentProps<typeof SpinnerIcon>) {
  return (
    <SpinnerIcon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
