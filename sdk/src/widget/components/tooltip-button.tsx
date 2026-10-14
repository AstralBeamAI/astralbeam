import { type ComponentProps, useCallback, useRef } from "react"
import { cn } from "cn"
import { WIDGET_CONTAINER_CLASS } from "../../lib/constants.ts"
import { Button } from "./ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"

export function TooltipButton({
  tooltip,
  className,
  "aria-label": ariaLabel = tooltip,
  ...props
}: ComponentProps<typeof Button> & { tooltip: string }) {
  const container = useRef<HTMLElement | null>(null)
  const setTrigger = useCallback((element: HTMLElement | null) => {
    container.current =
      element?.closest(`[data-slot=chat], [data-slot=mcp-servers], .${WIDGET_CONTAINER_CLASS}`) ??
      null
  }, [])
  return (
    <Tooltip>
      <TooltipTrigger
        ref={setTrigger}
        render={
          <Button
            aria-label={ariaLabel}
            className={cn("any-pointer-coarse:min-h-10 any-pointer-coarse:min-w-10", className)}
            {...props}
          />
        }
      />
      <TooltipContent container={container}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
