"use client"

import { GlobeIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ConfigKey } from "@/lib/types"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { ConfigFieldInput } from "./config-field-input"

export function ConfigFieldGroups({
  fields,
  drafts,
  fieldErrors,
  disabled,
  onDraftChange,
  onGenerate,
}: {
  fields: ConfigureField[]
  drafts: Record<string, FieldDraft>
  fieldErrors: Record<string, string>
  disabled: boolean
  onDraftChange: (key: string, draft: FieldDraft) => void
  onGenerate: (key: ConfigKey) => void
}) {
  const fieldsByGroup = Map.groupBy(fields, (field) => field.group)

  return [...fieldsByGroup].map(([group, groupFields]) => {
    return (
      <Card key={group}>
        <CardHeader>
          <CardTitle>{group}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {groupFields.map((field) => (
            <ConfigFieldInput
              key={field.key}
              field={field}
              draft={drafts[field.key] ?? { kind: "unchanged" }}
              error={fieldErrors[field.key]}
              disabled={disabled}
              onDraftChange={(draft) => onDraftChange(field.key, draft)}
              onGenerate={field.canGenerate ? () => onGenerate(field.key) : undefined}
              footer={field.source === "database" && field.key === "app_base_url"
                ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={disabled}
                    // Reading location in the handler keeps it out of the server render.
                    onClick={() =>
                      onDraftChange(field.key, { kind: "set", value: globalThis.location.origin })}
                  >
                    <GlobeIcon aria-hidden="true" />
                    Use current origin
                  </Button>
                )
                : undefined}
            />
          ))}
        </CardContent>
      </Card>
    )
  })
}
