import type { ReactNode } from "react"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function DocsCodeTabs({
  children,
  "data-attributes": attributes,
}: {
  children?: ReactNode
  "data-attributes": string
}) {
  const { tabs } = JSON.parse(attributes) as { tabs: { slug: string; name: string }[] }
  return (
    <Tabs defaultValue={tabs[0]?.slug} className="my-4 min-w-0 gap-0">
      <TabsList
        aria-label="Code examples"
        variant="line"
        className="w-full max-w-full justify-start overflow-x-auto border-b p-0 group-data-horizontal/tabs:h-auto"
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.slug}
            value={tab.slug}
            className="h-9 flex-none px-4 text-sm group-data-horizontal/tabs:after:bottom-0 any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11"
          >
            {tab.name}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  )
}
