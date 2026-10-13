export interface WebSource {
  url: string
  title: string
  excerpt?: string
}

export interface WebCitation extends WebSource {
  /** UTF-16 offsets into the text part. The link follows endIndex. */
  startIndex: number
  endIndex: number
  /** Response-wide citation number. */
  number: number
}

export interface WebEvidence {
  sources: WebSource[]
  citations: WebCitation[]
}

export interface WebPartMetadata {
  providerExecuted?: boolean
  web?: WebEvidence
}

export function webPartMetadata(part: object): WebPartMetadata {
  return (part as { metadata?: WebPartMetadata }).metadata ?? {}
}

export function safeWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

export function citedWebText(content: string, citations: readonly WebCitation[]): string {
  return [...citations]
    .sort((a, b) => b.endIndex - a.endIndex || b.number - a.number)
    .reduce((text, citation) => {
      const url = safeWebUrl(citation.url)
      return url && citation.startIndex >= 0 && citation.endIndex <= content.length
        ? `${text.slice(0, citation.endIndex)} [${citation.number}](<${url}>)${text.slice(citation.endIndex)}`
        : text
    }, content)
    .replaceAll(/cite[^]*/gu, "")
}
