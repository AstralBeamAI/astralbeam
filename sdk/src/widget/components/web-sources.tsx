import { readWebEvidence } from "../../core/web.ts"

export function WebSources({ metadata }: { metadata: unknown }) {
  const { sources } = readWebEvidence(metadata)
  if (!sources.length) return null
  return (
    <div
      className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
      aria-label="Consulted sources"
    >
      {sources.map((source) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {source.title}
        </a>
      ))}
    </div>
  )
}
