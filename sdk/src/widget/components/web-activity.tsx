import { GlobeIcon, WarningCircleIcon } from "@phosphor-icons/react"
import type { ChatToolCallPart } from "../../core/threads.ts"
import { safeWebUrl, webPartMetadata } from "../../core/web.ts"
import { ToolDisclosure } from "./tool-disclosure.tsx"
import { Spinner } from "./ui/spinner.tsx"
import { Trace, TraceDescription, TraceLine, TraceTitle } from "./ui/trace.tsx"

export function WebActivity({ part, active }: { part: ChatToolCallPart; active: boolean }) {
  const evidence = webPartMetadata(part).web
  const sources = [
    ...new Map(
      (evidence?.sources ?? []).flatMap((source) => {
        const url = safeWebUrl(source.url)
        return url ? [[url, { ...source, url }] as const] : []
      }),
    ).values(),
  ]
  const pending = part.state !== "complete" && part.state !== "error"
  const running = active && pending
  return (
    <ToolDisclosure
      running={running}
      failed={part.state === "error"}
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
      <Trace>
        {sources.map((source) => (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="nofollow noopener noreferrer"
            referrerPolicy="no-referrer"
            className="min-w-0 flex-col items-start any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11 any-pointer-coarse:justify-center"
          >
            <TraceLine>
              <TraceTitle className="whitespace-normal wrap-anywhere">
                {source.title && source.title !== source.url
                  ? source.title
                  : new URL(source.url).pathname}
                <span className="sr-only"> (opens in a new tab)</span>
              </TraceTitle>
            </TraceLine>
            <TraceDescription className="min-w-0 text-xs wrap-anywhere">
              {new URL(source.url).hostname}
            </TraceDescription>
          </a>
        ))}
      </Trace>
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
