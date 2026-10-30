import { Effect, Schema } from "effect"

type CatalogMatch =
  | { equals: string }
  | { starts_with: string }
  | { ends_with: string }
  | { contains: string }
  | { regex: string }
  | { or: readonly CatalogMatch[] }
  | { and: readonly CatalogMatch[] }
const catalogMatchSchema: Schema.Codec<CatalogMatch> = Schema.suspend(() =>
  Schema.Union([
    Schema.Struct({ equals: Schema.String }),
    Schema.Struct({ starts_with: Schema.String }),
    Schema.Struct({ ends_with: Schema.String }),
    Schema.Struct({ contains: Schema.String }),
    Schema.Struct({ regex: Schema.String }),
    Schema.Struct({ or: Schema.Array(catalogMatchSchema) }),
    Schema.Struct({ and: Schema.Array(catalogMatchSchema) }),
  ]),
)
const catalogRateSchema = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const catalogDateSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return (
      !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() > 0 &&
      date.toISOString().startsWith(value)
    )
  }),
)
const catalogPricesSchema = Schema.Record(
  Schema.String,
  Schema.Union([
    catalogRateSchema,
    Schema.Struct({
      base: catalogRateSchema,
      tiers: Schema.Array(
        Schema.Struct({
          start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
          price: catalogRateSchema,
        }),
      ),
    }),
  ]),
)
const catalogProviderSchema = Schema.Struct({
  id: Schema.String,
  api_pattern: Schema.String,
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      match: catalogMatchSchema,
      context_window: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
      prices: Schema.Union([
        catalogPricesSchema,
        Schema.NonEmptyArray(
          Schema.Struct({
            constraint: Schema.optionalKey(
              Schema.Union([
                Schema.Struct({
                  type: Schema.Literal("start_date").pipe(
                    Schema.withDecodingDefaultKey(Effect.succeed("start_date")),
                  ),
                  start_date: catalogDateSchema,
                }),
                Schema.Struct({
                  type: Schema.Literal("time_of_date").pipe(
                    Schema.withDecodingDefaultKey(Effect.succeed("time_of_date")),
                  ),
                  start_time: Schema.String,
                  end_time: Schema.String,
                }),
              ]),
            ),
            prices: catalogPricesSchema,
          }),
        ),
      ]),
    }),
  ),
})
export const ModelPriceCatalogProvidersSchema = Schema.Array(catalogProviderSchema)

export const ModelPriceCatalogSchema = Schema.Struct({
  providers: ModelPriceCatalogProvidersSchema,
})
export type ModelPriceCatalog = typeof ModelPriceCatalogSchema.Type
