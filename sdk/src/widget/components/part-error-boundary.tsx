import { WarningCircleIcon } from "@phosphor-icons/react"
import { Component, type ReactNode } from "react"
import { Marker, MarkerContent, MarkerIcon } from "@/widget/components/ui/marker"

// React tears down the whole tree on an uncaught render error and the shadow root
// has no other boundary, so a malformed agent-chosen part degrades to a placeholder.
export class PartErrorBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <Marker>
        <MarkerIcon>
          <WarningCircleIcon />
        </MarkerIcon>
        <MarkerContent>Part of this response could not be displayed</MarkerContent>
      </Marker>
    )
  }
}
