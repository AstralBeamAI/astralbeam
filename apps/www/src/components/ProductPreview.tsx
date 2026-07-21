import logoSymbol from "@astralbeam/brand/logo/png/astralbeam-symbol.png"
import { Card } from "@astralbeam/ui/components/card"
import { Separator } from "@astralbeam/ui/components/separator"
import { Skeleton } from "@astralbeam/ui/components/skeleton"

const lanes = [0, 1, 2]

export function ProductPreview() {
  return (
    <Card className="w-full max-w-xl gap-0 bg-muted/20 py-0 ring-primary/20" aria-hidden="true">
      <div className="flex h-12 items-center gap-2 border-b bg-background px-4">
        <span className="size-2 rounded-full bg-muted" />
        <span className="size-2 rounded-full bg-muted" />
        <span className="size-2 rounded-full bg-muted" />
        <Skeleton className="ml-2 h-2.5 w-28" />
      </div>
      <div className="grid min-h-80 grid-cols-[3rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 border-r bg-background p-3">
          {lanes.map((lane) => (
            <Skeleton key={lane} className="aspect-square w-full" />
          ))}
        </div>
        <div className="grid min-w-0 gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.9fr)]">
          <Card className="hidden min-w-0 gap-3 bg-background p-4 sm:flex">
            <div className="flex justify-between">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-2.5 w-12" />
            </div>
            <div className="grid flex-1 grid-cols-3 gap-2">
              {lanes.map((lane) => (
                <div key={lane} className="space-y-2 border p-2">
                  <Skeleton className="h-2 w-1/2" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ))}
            </div>
          </Card>
          <Card className="min-w-0 gap-3 bg-background p-4 ring-primary/40">
            <div className="flex items-center justify-between">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="size-5 rounded-full" />
            </div>
            <Separator />
            <div className="ml-auto w-3/4 space-y-2 rounded-lg bg-muted p-3">
              <Skeleton className="h-2 w-full bg-background" />
              <Skeleton className="h-2 w-2/3 bg-background" />
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-primary/30 p-3">
              <img src={logoSymbol.src} className="size-10 invert" alt="" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-2 w-3/4" />
              </div>
            </div>
            <div className="mt-auto flex gap-2">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="size-7 rounded-full" />
            </div>
          </Card>
        </div>
      </div>
    </Card>
  )
}
