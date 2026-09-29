import { Predicate, SchemaAST } from "effect"

/**
 * The status an error's class declares for HttpApi, so server functions and the REST transport
 * agree. Only user-facing error classes declare one, alongside their fixed user-safe message.
 */
export function httpApiStatus(error: unknown): number | undefined {
  const errorClass: unknown = Predicate.isObject(error) ? error.constructor : undefined
  const ast = Predicate.hasProperty(errorClass, "ast") ? errorClass.ast : undefined
  return (SchemaAST.isAST(ast) && SchemaAST.resolveAt<number>("httpApiStatus")(ast)) || undefined
}
