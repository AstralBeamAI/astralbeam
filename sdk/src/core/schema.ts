import { convertSchemaToJsonSchema, type SchemaInput } from "@tanstack/ai/client"
import type { JsonSchemaObject, ParametersSchema, StandardSchemaV1 } from "../lib/types.ts"

// Standard Schemas convert when the library exposes Standard JSON Schema (Zod v4+,
// ArkType); validate-only ones fall back to an open object, still validated client-side.
export function toJsonSchema(parameters?: ParametersSchema): JsonSchemaObject {
  if (!parameters) return { type: "object" }
  if (!("~standard" in parameters)) return parameters
  try {
    return convertSchemaToJsonSchema(parameters as SchemaInput) as JsonSchemaObject
  } catch {
    return { type: "object" }
  }
}

// Agent-supplied input is untrusted: a Standard Schema validates it before host code
// runs (null means rejected); a plain JSON Schema has no validator and passes through.
export async function validateParameters(
  parameters: ParametersSchema | undefined,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!parameters || !("~standard" in parameters)) return input
  const result = (await (parameters as StandardSchemaV1)["~standard"].validate(input)) as {
    value?: Record<string, unknown>
    issues?: unknown
  }
  return result.issues ? null : result.value ?? {}
}
