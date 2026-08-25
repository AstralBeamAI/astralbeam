"use client"

import { GlobeIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CURRENT_ORIGIN_KEY, FIELD_GROUPS, ROTATABLE_KEYS } from "../-lib/constants"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { ConfigFieldInput } from "./config-field-input"

export function ConfigFieldGroups({
  fields,
  drafts,
  fieldErrors,
  disabled,
  onDraftChange,
  onRotate,
}: {
  fields: ConfigureField[]
  drafts: Record<string, FieldDraft>
  fieldErrors: Record<string, string>
  disabled: boolean
  onDraftChange: (key: string, draft: FieldDraft) => void
  onRotate: (key: string) => void
}) {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]))

  return FIELD_GROUPS.map((group) => {
    const groupFields = group.keys
      .map((key) => fieldsByKey.get(key))
      .filter((field): field is ConfigureField => field !== undefined)
    if (groupFields.length === 0) return null

    return (
      <Card key={group.title}>
        <CardHeader>
          <CardTitle>{group.title}</CardTitle>
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
              onRotate={ROTATABLE_KEYS.has(field.key) ? () => onRotate(field.key) : undefined}
              footer={field.key === CURRENT_ORIGIN_KEY
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
