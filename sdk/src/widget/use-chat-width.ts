import { useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react"
import type { MountAstralBeamChatOptions } from "../lib/types.ts"

function readWidth(key: string | null): number | null {
  if (!key) return null
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null")
    if (
      value &&
      typeof value === "object" &&
      "width" in value &&
      typeof value.width === "number" &&
      Number.isFinite(value.width) &&
      value.width > 0
    )
      return value.width
  } catch {
    // Browser storage is optional, including when access itself is blocked.
  }
  return null
}

export function useChatWidth(options: MountAstralBeamChatOptions, host: HTMLElement) {
  const component = host.id ? `:component:${encodeURIComponent(host.id)}` : ""
  const agent = options.agentId ? `:agent:${encodeURIComponent(options.agentId)}` : ""
  const key = component || agent ? `astralbeam:chat-size:v1${component}${agent}` : null
  const [preference, setPreference] = useState(() => ({ key, value: readWidth(key) }))
  if (preference.key !== key) setPreference({ key, value: readWidth(key) })
  const saved = preference.key === key ? preference.value : null
  const [bounds, setBounds] = useState({
    maximum: 0,
    fallback: null as number | null,
    mobile: false,
  })
  const drag = useRef<{
    element: HTMLDivElement
    pointerId: number
    x: number
    width: number
    next: number
    direction: number
    scale: number
  } | null>(null)
  const { resizeContainer, onClose, initialWidth: initial } = options
  const closable = !!onClose

  useLayoutEffect(() => {
    const boundary = resizeContainer?.() ?? host.parentElement
    if (!boundary) return
    const mobile = matchMedia("(max-width: 900px)")
    const measure = () => {
      const style = getComputedStyle(boundary)
      const maximum =
        closable && mobile.matches
          ? window.innerWidth
          : boundary.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const fallback =
        host.getClientRects().length > 0 && (host.offsetWidth > 0 || initial !== undefined)
          ? host.offsetWidth
          : null
      if (maximum <= 0) return
      setBounds((previous) => {
        const next = {
          maximum,
          fallback: previous.fallback ?? fallback,
          mobile: closable && mobile.matches,
        }
        return next.maximum === previous.maximum &&
          next.fallback === previous.fallback &&
          next.mobile === previous.mobile
          ? previous
          : next
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(boundary)
    observer.observe(host)
    mobile.addEventListener("change", measure)
    return () => {
      observer.disconnect()
      mobile.removeEventListener("change", measure)
    }
  }, [host, resizeContainer, closable, initial])

  const maximum = Math.floor(bounds.maximum)
  const minimum = Math.min(320, maximum)
  const defaultWidth =
    initial === "100%"
      ? maximum
      : initial && Number.isFinite(initial) && initial > 0
        ? initial
        : (bounds.fallback ?? 0)
  const preferred = saved ?? defaultWidth
  const clamp = (value: number) => Math.round(Math.min(maximum, Math.max(minimum, value)))
  const width = bounds.mobile ? maximum : clamp(preferred)
  const enabled = options.resizable !== false && !bounds.mobile && maximum > minimum

  const paint = (value: number) => {
    host.style.setProperty("width", `${value}px`)
    host.setAttribute("data-astralbeam-full-width", String(value >= maximum))
  }
  const cancelDrag = () => {
    const active = drag.current
    if (!active) return
    drag.current = null
    paint(width)
    active.element.setAttribute("aria-valuenow", String(width))
    active.element.setAttribute("aria-valuetext", `${width} pixels`)
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId)
  }

  useLayoutEffect(() => {
    const originalWidth = host.style.getPropertyValue("width")
    const widthPriority = host.style.getPropertyPriority("width")
    const originalBoxSizing = host.style.boxSizing
    const originalFullWidth = host.getAttribute("data-astralbeam-full-width")
    host.style.setProperty("box-sizing", "border-box")
    return () => {
      const active = drag.current
      drag.current = null
      if (active?.element.hasPointerCapture(active.pointerId))
        active.element.releasePointerCapture(active.pointerId)
      host.style.setProperty("width", originalWidth, widthPriority)
      host.style.setProperty("box-sizing", originalBoxSizing)
      if (originalFullWidth === null) host.removeAttribute("data-astralbeam-full-width")
      else host.setAttribute("data-astralbeam-full-width", originalFullWidth)
    }
  }, [host])

  useLayoutEffect(() => {
    const active = drag.current
    drag.current = null
    if (active) {
      active.element.setAttribute("aria-valuenow", String(width))
      active.element.setAttribute("aria-valuetext", `${width} pixels`)
    }
    if (active?.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId)
    // A hidden mount must reveal its original CSS width before a saved width replaces it.
    if (maximum > 0 && bounds.fallback !== null) {
      host.style.setProperty("width", `${width}px`)
      host.setAttribute("data-astralbeam-full-width", String(width >= maximum))
    }
  }, [host, width, maximum, bounds.fallback, enabled, key])

  const resize = (value: number) => {
    if (!enabled || !Number.isFinite(value)) return
    const next = clamp(value)
    if (next === width) return
    const override = next === clamp(defaultWidth) ? null : next
    setPreference({ key, value: override })
    if (!key) return
    try {
      if (override === null) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify({ width: override }))
    } catch {
      // A full or disabled store must not prevent resizing this chat.
    }
  }
  return {
    enabled,
    width,
    minimum,
    maximum,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (!enabled || !event.isPrimary || event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = {
        element: event.currentTarget,
        pointerId: event.pointerId,
        x: event.clientX,
        width,
        next: width,
        direction: getComputedStyle(host).direction === "rtl" ? 1 : -1,
        scale: host.getBoundingClientRect().width / host.offsetWidth,
      }
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const active = drag.current
      if (!active || active.pointerId !== event.pointerId) return
      active.next = clamp(
        active.width + ((event.clientX - active.x) * active.direction) / active.scale,
      )
      paint(active.next)
      active.element.setAttribute("aria-valuenow", String(active.next))
      active.element.setAttribute("aria-valuetext", `${active.next} pixels`)
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const active = drag.current
      if (!active || active.pointerId !== event.pointerId) return
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      resize(active.next)
    },
    cancelDrag,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const direction = getComputedStyle(host).direction === "rtl" ? 1 : -1
      const step = event.shiftKey ? 50 : 10
      if (event.key === "ArrowLeft") resize(width - step * direction)
      else if (event.key === "ArrowRight") resize(width + step * direction)
      else if (event.key === "Home") resize(minimum)
      else if (event.key === "End") resize(maximum)
      else if (event.key === "Escape" && drag.current) cancelDrag()
      else return
      event.preventDefault()
    },
  }
}
