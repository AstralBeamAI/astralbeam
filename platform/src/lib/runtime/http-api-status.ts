import { Predicate, SchemaAST } from "effect"

/** The `httpApiStatus` an error's schema class declares, so every transport agrees on it. */
export function declaredHttpApiStatus(error: unknown): number | undefined {
  const errorClass: unknown = Predicate.isObject(error) ? error.constructor : undefined
  const ast = Predicate.hasProperty(errorClass, "ast") ? errorClass.ast : undefined
  return SchemaAST.isAST(ast) ? SchemaAST.resolveAt<number>("httpApiStatus")(ast) : undefined
}
