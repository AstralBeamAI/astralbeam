import { Button } from "@astralbeam/ui/components/button"
import { cn } from "@astralbeam/ui/lib/utils"
import { RiArrowRightLine } from "@remixicon/react"

export const WAITLIST_URL = "https://airtable.com/app5bJZxFB5NoPBUX/paghAGYUoz5JoIQDs/form"

interface WaitlistCtaProps {
  label?: string
  variant?: "default" | "outline" | "ghost"
  className?: string
  showArrow?: boolean
}

export function WaitlistCta({
  label = "Join the waitlist",
  variant = "default",
  className,
  showArrow = true,
}: WaitlistCtaProps) {
  return (
    <Button
      variant={variant}
      className={cn("h-11 gap-2 px-5 text-sm", className)}
      render={
        <a href={WAITLIST_URL} target="_blank" rel="noopener noreferrer">
          {label}
          {showArrow ? <RiArrowRightLine /> : null}
        </a>
      }
    />
  )
}
