/** Portable web evidence. Sources were consulted, citations support specific answer text. */
export interface WebSource {
  url: string
  title: string
  excerpt?: string
}

export interface WebCitation extends WebSource {
  /** UTF-16 offsets into this text part. A citation is inserted after endIndex. */
  startIndex: number
  endIndex: number
}

export interface WebEvidence {
  sources: WebSource[]
  citations: WebCitation[]
}

export interface WebPartMetadata {
  providerExecuted?: boolean
  web?: WebEvidence
}

export function webPartMetadata(part: unknown): WebPartMetadata {
  const metadata = (part as { metadata?: WebPartMetadata } | undefined)?.metadata
  return {
    ...(metadata?.providerExecuted === true ? { providerExecuted: true } : {}),
    web: readWebEvidence(metadata),
  }
}

export function safeWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  try {
    const url = new URL(value)
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password)
      return url.href
  } catch {
    // Provider links are untrusted presentation data.
  }
  return undefined
}

export function readWebEvidence(metadata: unknown): WebEvidence {
  const evidence = metadata as { web?: Partial<WebEvidence> } | undefined
  const readSource = (source: WebSource): WebSource | undefined => {
    const url = safeWebUrl(source?.url)
    if (!url) return undefined
    return {
      url,
      title: typeof source.title === "string" ? source.title : url,
      ...(typeof source.excerpt === "string" ? { excerpt: source.excerpt } : {}),
    }
  }
  return {
    sources: Array.isArray(evidence?.web?.sources)
      ? evidence.web.sources.flatMap((source) => readSource(source) ?? [])
      : [],
    citations: Array.isArray(evidence?.web?.citations)
      ? evidence.web.citations.flatMap((citation) => {
          const source = readSource(citation)
          return source &&
            Number.isInteger(citation.startIndex) &&
            Number.isInteger(citation.endIndex) &&
            citation.startIndex >= 0 &&
            citation.endIndex >= citation.startIndex
            ? [{ ...source, startIndex: citation.startIndex, endIndex: citation.endIndex }]
            : []
        })
      : [],
  }
}

export function citedWebText(content: string, metadata: unknown): string {
  const citations = readWebEvidence(metadata).citations
  let result = content
  for (const [index, citation] of citations
    .map((citation, index) => [index, citation] as const)
    .sort((a, b) => b[1].endIndex - a[1].endIndex || b[0] - a[0])) {
    if (citation.endIndex > content.length) continue
    const url = citation.url.replaceAll("(", "%28").replaceAll(")", "%29")
    result = `${result.slice(0, citation.endIndex)} [${index + 1}](${url})${result.slice(citation.endIndex)}`
  }
  return result
}
