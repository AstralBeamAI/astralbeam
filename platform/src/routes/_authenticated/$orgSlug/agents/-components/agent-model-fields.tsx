import { Link } from "@tanstack/react-router"

import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ModelChoice } from "@/lib/model-providers/model-providers.server"

export function AgentModelFields({
  organizationSlug,
  models,
  modelIds,
  disabled,
  onChange,
}: {
  organizationSlug: string
  models: readonly ModelChoice[]
  modelIds: readonly string[]
  disabled: boolean
  onChange: (modelIds: string[]) => void
}) {
  const selectedModels = modelIds.flatMap((id) => models.filter((model) => model.id === id))
  const defaultItems = selectedModels.map((model) => ({
    value: model.id,
    label: `${model.name} (${model.providerName})`,
  }))
  return (
    <FieldSet aria-describedby="agent-models-description agent-models-hint">
      <FieldLegend>Models</FieldLegend>
      <FieldDescription id="agent-models-description">
        Choose models from your configured providers. The default model handles new chat runs.
      </FieldDescription>
      {models.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Enable a model in{" "}
          <Link to="/$orgSlug/models" params={{ orgSlug: organizationSlug }} className="underline">
            Models
          </Link>{" "}
          before saving this agent.
        </p>
      ) : (
        <FieldGroup className="max-h-64 overflow-y-auto rounded-lg border p-3">
          {models.map((model) => (
            <Field key={model.id} orientation="horizontal">
              <Checkbox
                id={`agent-model-${model.id}`}
                checked={modelIds.includes(model.id)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange(
                    checked ? [...modelIds, model.id] : modelIds.filter((id) => id !== model.id),
                  )
                }
              />
              <FieldLabel htmlFor={`agent-model-${model.id}`} className="font-normal">
                {model.name} ({model.providerName})
              </FieldLabel>
            </Field>
          ))}
        </FieldGroup>
      )}
      {models.length > 0 && modelIds.length === 0 && (
        <FieldDescription id="agent-models-hint">
          Select at least one model to save.
        </FieldDescription>
      )}
      {defaultItems.length > 0 && (
        <Field>
          <FieldLabel htmlFor="agent-default-model">Default model</FieldLabel>
          <Select
            items={defaultItems}
            value={modelIds[0]}
            disabled={disabled}
            onValueChange={(value) => {
              if (value) onChange([value, ...modelIds.filter((id) => id !== value)])
            }}
          >
            <SelectTrigger id="agent-default-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {defaultItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </FieldSet>
  )
}
