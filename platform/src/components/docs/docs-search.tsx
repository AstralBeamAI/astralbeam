import { Autocomplete } from "@base-ui/react/autocomplete"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { DocsChunk } from "@/routes/docs/-lib/search"

export function DocsSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const term = query.trim()
  const deferredQuery = useDeferredValue(term)
  const search = useQuery({
    queryKey: ["docs-search", deferredQuery],
    queryFn: async () => (await import("@/routes/docs/-lib/search")).searchDocs(deferredQuery),
    enabled: open && Boolean(deferredQuery),
    staleTime: Infinity,
    retry: false,
  })
  const pending = term !== deferredQuery || search.isFetching
  const results = pending || !term ? [] : (search.data?.results ?? [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Search documentation" />}
            />
          }
        >
          <MagnifyingGlassIcon />
        </TooltipTrigger>
        <TooltipContent>Search documentation</TooltipContent>
      </Tooltip>
      <DialogContent className="gap-3 sm:max-w-xl">
        <DialogTitle>Search documentation</DialogTitle>
        <DialogDescription className="sr-only">
          Find guides and API reference pages. Use the arrow keys to choose a result and Enter to
          open it.
        </DialogDescription>
        <Autocomplete.Root
          items={results}
          value={query}
          onValueChange={setQuery}
          itemToStringValue={(result: DocsChunk) => result.heading}
          mode="none"
          inline
          open
          autoHighlight="always"
        >
          <Autocomplete.Input
            render={<Input />}
            aria-label="Search documentation"
            placeholder="Search documentation…"
            maxLength={255}
            className="h-11 text-sm md:text-sm"
          />
          <Autocomplete.Status className="px-1 text-xs text-muted-foreground">
            {!term
              ? "Type to search the documentation."
              : pending
                ? "Searching…"
                : search.isError
                  ? "Search could not load."
                  : results.length
                    ? `${results.length} results`
                    : "No results. Try fewer or different words."}
          </Autocomplete.Status>
          {search.isError && (
            <Button variant="outline" onClick={() => void search.refetch()}>
              Try again
            </Button>
          )}
          <Autocomplete.List className="max-h-[min(55dvh,28rem)] overflow-y-auto">
            {(result: DocsChunk) => (
              <Autocomplete.Item
                key={result.url}
                value={result}
                render={<a href={result.url} aria-label={`${result.page}: ${result.heading}`} />}
                onClick={() => setOpen(false)}
                className="block cursor-pointer space-y-1 px-3 py-3 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground any-pointer-coarse:min-h-11"
              >
                <span className="block text-xs text-muted-foreground">{result.page}</span>
                <span className="block text-sm font-medium">{result.heading}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{result.text}</span>
              </Autocomplete.Item>
            )}
          </Autocomplete.List>
        </Autocomplete.Root>
      </DialogContent>
    </Dialog>
  )
}
