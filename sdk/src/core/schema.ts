import {
  convertSchemaToJsonSchema,
  validateWithStandardSchema,
  type SchemaInput,
} from "@tanstack/ai/client"
import type { JsonSchemaObject, ParametersSchema, StandardSchemaV1 } from "../lib/types.ts"

// Standard Schemas convert via Standard JSON Schema (Zod v4.2+, ArkType). Validation-only schemas
// fall back to an open object, none to an empty one. Export failures surface instead of falling back.
export function toJsonSchema(parameters?: ParametersSchema): JsonSchemaObject {
  if (!parameters) return { type: "object", properties: {} }
  if (!("~standard" in parameters)) return parameters
  const standard = (parameters as StandardSchemaV1)["~standard"]
  return "jsonSchema" in standard
    ? (convertSchemaToJsonSchema(parameters as SchemaInput) as JsonSchemaObject)
    : { type: "object" }
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
