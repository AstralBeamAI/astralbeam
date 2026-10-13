import { GlobeIcon, WarningCircleIcon } from "@phosphor-icons/react"
import type { ChatToolCallPart } from "../../core/threads.ts"
import { safeWebUrl, webPartMetadata } from "../../core/web.ts"
import { ToolDisclosure } from "./tool-disclosure.tsx"
import { Spinner } from "./ui/spinner.tsx"

export function WebActivity({ part, active }: { part: ChatToolCallPart; active: boolean }) {
  const evidence = webPartMetadata(part).web
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
              : "Web access"
      }
    >
      <ul className="space-y-1 text-xs">
        {evidence?.sources.map((source) => {
          const url = safeWebUrl(source.url)
          return url ? (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
                {source.title}
              </a>
            </li>
          ) : null
        })}
      </ul>
    </ToolDisclosure>
  )
}
