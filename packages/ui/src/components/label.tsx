// shadcn command: `vp run @astralbeam/ui#ui add label`
// Local edits: Requires an explicit control id so shared labels always satisfy the repository's accessibility checks.

import * as React from "react"

import { cn } from "@/lib/utils"

function Label({
  className,
  htmlFor,
  ...props
}: React.ComponentProps<"label"> & { htmlFor: string }) {
  return (
    <label
      data-slot="label"
      htmlFor={htmlFor}
      className={cn(
        "flex items-center gap-2 text-xs leading-none select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Label }
