// shadcn command: `vp run @astralbeam/webapp#ui add skeleton`

import { cn } from "@/ui/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-none bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
