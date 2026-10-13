import { Schema } from "effect"

/**
 * A tool input TanStack validates with Effect before `execute` and declares to the model as a
 * closed object, because OpenAI holds a model to a tool's schema only when no object in it is open.
 * https://platform.openai.com/docs/guides/function-calling#strict-mode
 */
export function chatToolInputSchema<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const standard = Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema))
  const closed = () => Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" }).schema
  Object.assign(standard["~standard"].jsonSchema, { input: closed, output: closed })
  return standard
}
