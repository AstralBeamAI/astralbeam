import {
  convertSchemaToJsonSchema,
  validateWithStandardSchema,
  type SchemaInput,
} from "@tanstack/ai/client"
import { JsonSchema, Schema, SchemaRepresentation } from "effect"
import { toolResult } from "../lib/define.ts"
import type {
  JsonSchemaObject,
  ParametersSchema,
  ToolResult,
  StandardSchemaV1,
} from "../lib/types.ts"

export function toJsonSchema(
  schema?: ParametersSchema,
  io: "input" | "output" = "input",
): JsonSchemaObject {
  if (!schema) return { type: "object", properties: {}, additionalProperties: false }
  if (!("~standard" in schema)) return schema
  if (!("jsonSchema" in (schema as StandardSchemaV1)["~standard"]))
    throw new Error("A tool or widget schema must provide JSON Schema export")
  return convertSchemaToJsonSchema(schema as SchemaInput, { io }) as JsonSchemaObject
}

export async function validateParameters(
  schema: ParametersSchema | undefined,
  input: unknown,
): Promise<Record<string, unknown> | null> {
  if (!schema || !("~standard" in schema)) {
    const validator = compileJsonSchema(toJsonSchema(schema))
    const decoded = Schema.decodeUnknownExit(validator, { onExcessProperty: "error" })(input)
    return decoded._tag === "Success" ? (decoded.value as Record<string, unknown>) : null
  }
  const result = await validateWithStandardSchema<Record<string, unknown>>(schema, input)
  return result.success ? (result.data ?? {}) : null
}

export function compileJsonSchema(schema: JsonSchemaObject) {
  return SchemaRepresentation.fromJsonSchemaDocument(
    JsonSchema.fromSchemaDraft2020_12(schema as JsonSchema.JsonSchema),
    { patterns: "apply" },
  ).pipe(Schema.toType)
}

const resultSchema = Schema.Struct({
  content: Schema.Array(
    Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [Schema.JsonObject]),
  ),
  structuredContent: Schema.optionalKey(Schema.JsonObject),
  uiData: Schema.optionalKey(Schema.JsonObject),
  isError: Schema.optionalKey(Schema.Boolean),
})

export function validateToolResult(
  output: object,
  outputSchema?: ReturnType<typeof compileJsonSchema>,
): ToolResult {
  const result =
    Symbol.toStringTag in output && output[Symbol.toStringTag] === "AstralBeam.ToolResult"
      ? output
      : toolResult({ structuredContent: output })
  const validated = Schema.decodeUnknownSync(resultSchema, { onExcessProperty: "error" })(
    Object.fromEntries(Object.entries(result)),
  )
  if (outputSchema && !validated.isError)
    Schema.decodeUnknownSync(outputSchema, { onExcessProperty: "error" })(
      validated.structuredContent,
    )
  return validated
}
