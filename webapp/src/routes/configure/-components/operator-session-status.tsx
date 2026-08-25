"use client"

import { useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"

function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${
    String(seconds % 60).padStart(2, "0")
  }`
}

export function OperatorSessionStatus({
  dbUsername,
  sessionExpiresAt,
}: {
  dbUsername: string
  sessionExpiresAt: string
}) {
  const router = useRouter()
  const expiresAt = new Date(sessionExpiresAt).getTime()
  const [remaining, setRemaining] = useState(() => expiresAt - Date.now())

  useEffect(() => {
    const tick = () => setRemaining(expiresAt - Date.now())
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  // Reloading once the session expires replaces the editor with the login form instead of leaving
  // an operator typing into controls whose every request now fails.
  useEffect(() => {
    if (remaining <= 0) void router.invalidate()
  }, [remaining, router])

  return (
    <p className="text-sm text-muted-foreground">
      Signed in as <strong>{dbUsername}</strong> · This session ends in{" "}
      {/* The server render uses the server clock, so the first client tick may differ by a tick. */}
      <span suppressHydrationWarning className="font-mono tabular-nums">
        {formatRemaining(remaining)}
      </span>
    </p>
  )
}
