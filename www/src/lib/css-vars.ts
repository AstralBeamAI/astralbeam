import type { CSSProperties } from "react"

// The layout drives its reveal delays and chart heights through custom properties, which
// React's CSSProperties does not admit. https://github.com/facebook/react/issues/6411
export function cssVars(vars: Record<`--${string}`, string>) {
  return vars as CSSProperties
}
