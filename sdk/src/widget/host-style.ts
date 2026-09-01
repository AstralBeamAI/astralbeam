import type { DebugLogger } from "../lib/debug.ts"
import { collectCustomPropertyNames, hostStyleRule } from "./lib/utils.ts"

/**
 * Gives every widget slot the host page's inherited style through a single rule in the shadow
 * root, kept current as the page's theme changes. Needs no React: nothing here depends on the
 * transcript, and a stylesheet swap avoids re-rendering the chat when the page retheme.
 */
export function bridgeHostStyle(
  shadowRoot: ShadowRoot,
  // Resolved per line rather than captured: `debug` is a live option, so a logger bound at mount
  // would keep logging after the host turns it off, or stay silent after it turns it on.
  debug: () => DebugLogger | undefined,
): () => void {
  // The chat's own sheet styles the shadow host through `:host`, so reading the host's computed
  // style would feed the chat's font and palette straight back in; its parent is the nearest
  // element that inherits the page and nothing else.
  const source = (shadowRoot.host as HTMLElement).parentElement ?? document.body
  // Names only: the CSSOM cannot enumerate an element's custom properties, and a stylesheet edit
  // is the only thing that changes which names exist, so one scan per mount is enough.
  const customProperties = collectCustomPropertyNames()
  const style = document.createElement("style")
  shadowRoot.append(style)
  const apply = () => {
    style.textContent = hostStyleRule(source, customProperties)
    debug()?.("theme", "host style bridged onto widget slots", { rule: style.textContent })
  }
  apply()

  let frame = 0
  const schedule = () => {
    // Coalesced to one recompute per frame, after the browser has settled the class change that
    // triggered it, so the read sees post-change values instead of forcing a mid-mutation reflow.
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(apply)
  }
  // A theme switch usually toggles a class on an ancestor rather than on the source itself, and
  // inherited values change with no mutation at the source at all. The ancestor chain is short,
  // where `documentElement` with `subtree` would fire on every unrelated class change in the page.
  const observers: MutationObserver[] = []
  for (let node: Element | null = source; node; node = node.parentElement) {
    const observer = new MutationObserver(schedule)
    observer.observe(node, { attributeFilter: ["class", "style"] })
    observers.push(observer)
  }
  return () => {
    cancelAnimationFrame(frame)
    for (const observer of observers) observer.disconnect()
    style.remove()
  }
}
