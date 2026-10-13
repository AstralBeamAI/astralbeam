import { GlobeIcon, WarningCircleIcon } from "@phosphor-icons/react"
import type { ChatToolCallPart } from "../../core/threads.ts"
import { safeWebUrl, webPartMetadata } from "../../core/web.ts"
import { ToolDisclosure } from "./tool-disclosure.tsx"
import { Spinner } from "./ui/spinner.tsx"

export function WebActivity({ part, active }: { part: ChatToolCallPart; active: boolean }) {
  const evidence = webPartMetadata(part).web
  const sources = (evidence?.sources ?? []).flatMap((source) => {
    const url = safeWebUrl(source.url)
    return url ? [{ ...source, url }] : []
  })
  const pending = part.state !== "complete" && part.state !== "error"
  const running = active && pending
  return (
    <ToolDisclosure
      running={running}
      icon={part.state === "error" ? <WarningCircleIcon /> : running ? <Spinner /> : <GlobeIcon />}
      label={
        part.state === "error"
          ? "Web retrieval failed"
          : running
            ? "Searching and reading the web"
            : pending
              ? "Web retrieval unfinished"
              : sources.length
                ? `Consulted ${sources.length} source${sources.length === 1 ? "" : "s"}`
                : "Web retrieval complete"
      }
    >
      <ul className="space-y-1 text-xs">
        {sources.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="block break-words underline"
            >
              {source.title}
            </a>
            <span className="text-muted-foreground">{new URL(source.url).hostname}</span>
          </li>
        ))}
      </ul>
      {sources.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {running
            ? "Sources appear here as retrieval finishes."
            : "No source links were returned."}
        </p>
      )}
    </ToolDisclosure>
  )
}
