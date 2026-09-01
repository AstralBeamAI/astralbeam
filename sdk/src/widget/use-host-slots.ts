import { useEffect, useRef, useState } from "react"
import type { AstralBeamChatSlotRenderer, AstralBeamChatSlots } from "../lib/types.ts"
import type { DebugLogger } from "../lib/debug.ts"
import { HOST_SLOT_PREFIX } from "./lib/constants.ts"

export type HostSlotName = keyof AstralBeamChatSlots

const HOST_SLOT_NAMES: readonly HostSlotName[] = ["header", "empty", "composerActions"]

/** The `slot` attribute (and `<slot name>`) for a named chrome slot. */
export function hostSlotName(name: HostSlotName): string {
  return `${HOST_SLOT_PREFIX}${name === "composerActions" ? "composer-actions" : name}`
}

interface ActiveHostSlot {
  /** Compared by identity, so an update that keeps the same renderer leaves its DOM alone. */
  renderer: AstralBeamChatSlotRenderer
  container: HTMLElement
  cleanup: (() => void) | undefined
}

/**
 * Owns the host-rendered chrome slots (header, empty state, composer actions): light-DOM
 * containers projected into the widget through named <slot> elements, the same mechanism widget
 * renders use. Returns the slot names currently backed by host content, so the widget knows
 * where to render a <slot> instead of its own chrome.
 */
export function useHostSlots(
  slots: AstralBeamChatSlots | undefined,
  host: HTMLElement,
  debug: DebugLogger | undefined,
): ReadonlySet<HostSlotName> {
  const [active, setActive] = useState<ReadonlySet<HostSlotName>>(new Set())
  const rendered = useRef(new Map<HostSlotName, ActiveHostSlot>())
  useEffect(() => {
    for (const name of HOST_SLOT_NAMES) {
      const renderer = slots?.[name]
      const current = rendered.current.get(name)
      if (current?.renderer === renderer) continue
      if (current) {
        current.cleanup?.()
        current.container.remove()
        rendered.current.delete(name)
        debug?.("mount", `host slot "${name}" disposed`)
      }
      if (!renderer) continue
      const container = document.createElement("div")
      container.slot = hostSlotName(name)
      host.append(container)
      const cleanup = renderer(container)
      rendered.current.set(name, { renderer, container, cleanup: cleanup ?? undefined })
      debug?.("mount", `host slot "${name}" rendered`)
    }
    setActive((previous) => {
      const next = new Set(rendered.current.keys())
      // Set identity is the render trigger, so an unchanged set must not produce a new object.
      if (next.size === previous.size && [...next].every((name) => previous.has(name))) {
        return previous
      }
      return next
    })
  }, [slots, host, debug])
  useEffect(() =>
  // Unmount only: the per-slot effect above owns replacement during the widget's lifetime.
  () => {
    for (const slot of rendered.current.values()) {
      slot.cleanup?.()
      slot.container.remove()
    }
    rendered.current.clear()
  }, [])
  return active
}
