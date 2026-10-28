import { useRouterState } from "@tanstack/react-router"

import { Progress } from "@/components/ui/progress"

export function NavigationProgress() {
  const pending = useRouterState({ select: (state) => state.status === "pending" })

  if (!pending) return null

  return (
    <Progress
      value={null}
      aria-label="Loading page"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] [animation:navigation-reveal_150ms_step-end_both] [&_[data-slot=progress-track]]:h-0.5 [&_[data-slot=progress-indicator]]:w-full motion-safe:[&_[data-slot=progress-indicator]]:w-1/3 motion-safe:[&_[data-slot=progress-indicator]]:animate-[navigation-progress_1s_ease-in-out_infinite]"
    />
  )
}
