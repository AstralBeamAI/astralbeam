import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SandboxProviderId, SandboxProviderOptions } from "@/lib/sandbox/schemas"
import { SandboxTextField } from "./sandbox-text-field"

export type SandboxProviderOptionFieldsProps = {
  provider: SandboxProviderId
  options: SandboxProviderOptions[SandboxProviderId]
  disabled: boolean
  onChange: (patch: Record<string, unknown>) => void
}

export function SandboxProviderOptionFields({
  provider,
  options,
  disabled,
  onChange,
}: SandboxProviderOptionFieldsProps) {
  if (provider === "docker") {
    const value = options as SandboxProviderOptions["docker"]
    return (
      <SandboxTextField
        id="docker-image"
        label="Image"
        value={value.image}
        maximumLength={256}
        disabled={disabled}
        onChange={(image) => onChange({ image })}
      />
    )
  }
  if (provider === "daytona") {
    const value = options as SandboxProviderOptions["daytona"]
    return (
      <>
        <Field>
          <FieldLabel htmlFor="daytona-target">Target</FieldLabel>
          <Select
            value={value.target}
            onValueChange={(target) => onChange({ target })}
            disabled={disabled}
          >
            <SelectTrigger id="daytona-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="us">US</SelectItem>
              <SelectItem value="eu">EU</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <SandboxTextField
          id="daytona-snapshot"
          label="Snapshot"
          value={value.snapshot}
          maximumLength={256}
          disabled={disabled}
          onChange={(snapshot) => onChange({ snapshot })}
        />
      </>
    )
  }
  if (provider === "sprites") return null
  if (provider !== "vercel") return provider satisfies never
  const value = options as SandboxProviderOptions["vercel"]
  return (
    <>
      <SandboxTextField
        id="vercel-team-id"
        label="Team ID"
        value={value.teamId}
        maximumLength={256}
        disabled={disabled}
        onChange={(teamId) => onChange({ teamId })}
      />
      <SandboxTextField
        id="vercel-project-id"
        label="Project ID"
        value={value.projectId}
        maximumLength={256}
        disabled={disabled}
        onChange={(projectId) => onChange({ projectId })}
      />
      <Field>
        <FieldLabel htmlFor="vercel-runtime">Runtime</FieldLabel>
        <Select
          value={value.runtime}
          onValueChange={(runtime) => onChange({ runtime })}
          disabled={disabled}
        >
          <SelectTrigger id="vercel-runtime">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="node24">Node.js 24</SelectItem>
            <SelectItem value="node22">Node.js 22</SelectItem>
            <SelectItem value="python3.13">Python 3.13</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  )
}
