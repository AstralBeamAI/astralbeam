// shadcn command: `vp run @astralbeam/ui#ui add spinner`
// Local edits: Uses a semantic output wrapper required by repository accessibility linting and preserves exact Phosphor icon props.

import { SpinnerIcon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"output">) {
  return (
    <output
      data-slot="spinner"
      aria-label="Loading"
      className={cn("inline-flex", className)}
      {...props}
    >
      <SpinnerIcon aria-hidden="true" className="size-4 animate-spin" />
    </output>
  )
}

export { Spinner }
