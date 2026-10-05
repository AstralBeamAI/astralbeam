import {
  convertSchemaToJsonSchema,
  validateWithStandardSchema,
  type SchemaInput,
} from "@tanstack/ai/client"
import type { JsonSchemaObject, ParametersSchema } from "../lib/types.ts"

// Standard Schemas convert when the library exposes Standard JSON Schema (Zod v4+, ArkType). Others
// fall back to an open object, validated client-side, and none to an empty one OpenAI runs strictly.
export function toJsonSchema(parameters?: ParametersSchema): JsonSchemaObject {
  if (!parameters) return { type: "object", properties: {} }
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
  const result = await validateWithStandardSchema<Record<string, unknown>>(parameters, input)
  return result.success ? (result.data ?? {}) : null
}
