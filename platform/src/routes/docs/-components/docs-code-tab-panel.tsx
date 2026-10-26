import type { ReactNode } from "react"

import { TabsContent } from "@/components/ui/tabs"

export function DocsCodeTabPanel({
  children,
  "data-tab-slug": slug,
}: {
  children?: ReactNode
  "data-tab-slug": string
}) {
  return (
    <TabsContent value={slug} className="min-w-0 [&>figure>div]:mt-2">
      {children}
    </TabsContent>
  )
}
