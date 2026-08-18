import { color, ColorNotation, SyntaxFlag, type ColorData } from "@csstools/css-color-parser"
import {
  a98_RGB_to_XYZ_D65,
  clip,
  HSL_to_XYZ_D65,
  HWB_to_XYZ_D65,
  Lab_to_XYZ_D65,
  LCH_to_XYZ_D65,
  lin_P3_to_XYZ_D65,
  lin_sRGB_to_XYZ_D65,
  OKLab_to_XYZ_D65,
  OKLCH_to_XYZ_D65,
  P3_to_XYZ_D65,
  ProPhoto_RGB_to_XYZ_D65,
  rec_2020_to_XYZ_D65,
  sRGB_to_XYZ_D65,
  XYZ_D50_to_XYZ_D65,
  XYZ_D65_to_OKLCH,
  XYZ_D65_to_sRGB,
  type Color,
} from "@csstools/color-helpers"
import { parseListOfComponentValues } from "@csstools/css-parser-algorithms"
import { tokenize } from "@csstools/css-tokenizer"
import { Schema, SchemaIssue } from "effect"

import themeAuthoringSchema from "./theme.schema.json" with { type: "json" }

export type ThemeToken = keyof typeof themeAuthoringSchema.$defs.lightColors.properties
export const themeTokenNames: readonly ThemeToken[] = Object.freeze(
  Object.keys(themeAuthoringSchema.$defs.lightColors.properties).filter(isThemeTokenName),
)
export type ThemeMode = "light" | "dark"
export type ThemeCssVariableName = "--radius" | `--${ThemeToken}`
export type ThemeCssVariables = Readonly<Record<ThemeCssVariableName, string>>
export const defaultThemeRadius = themeAuthoringSchema.$defs.geometry.properties.radius.default
export const themeDefinitionSchemaUrl = themeAuthoringSchema.$id
const maximumThemeColorLength = findSchemaMaximumLength(
  themeAuthoringSchema.$defs.themeColor.allOf,
  "theme color",
)
const maximumThemeRadiusLength = findSchemaMaximumLength(
  themeAuthoringSchema.$defs.geometry.properties.radius.allOf,
  "theme radius",
)
const minimumTextContrast = 4.5
const minimumNonTextContrast = 3
const derivedTextContrast = 4.55
const derivedNonTextContrast = 3.05
const justNoticeableDeltaE = 0.02
const gamutMappingEpsilon = 0.000_1
const lightColorSchema = themeAuthoringSchema.$defs.lightColors.properties
const defaultLightBackground = lightColorSchema.background.default
const defaultLightCard = lightColorSchema.card.default
const defaultLightForeground = lightColorSchema.foreground.default
const defaultLightStatusColors = {
  destructive: lightColorSchema.destructive.default,
  warning: lightColorSchema.warning.default,
} as const
const defaultLightChartColors = {
  "chart-2": lightColorSchema["chart-2"].default,
  "chart-3": lightColorSchema["chart-3"].default,
  "chart-4": lightColorSchema["chart-4"].default,
  "chart-5": lightColorSchema["chart-5"].default,
} as const
const foregroundPairs = [
  ["background", "foreground"],
  ["card", "card-foreground"],
  ["popover", "popover-foreground"],
  ["primary", "primary-foreground"],
  ["secondary", "secondary-foreground"],
  ["muted", "muted-foreground"],
  ["accent", "accent-foreground"],
  ["sidebar", "sidebar-foreground"],
  ["sidebar-primary", "sidebar-primary-foreground"],
  ["sidebar-accent", "sidebar-accent-foreground"],
] as const satisfies readonly (readonly [ThemeToken, ThemeToken])[]
const standaloneForegroundPairs = [
  ["background", "destructive"],
  ["background", "warning"],
] as const satisfies readonly (readonly [ThemeToken, ThemeToken])[]
const nonTextContrastPairs = [
  ["background", "ring"],
  ["sidebar", "sidebar-ring"],
] as const satisfies readonly (readonly [ThemeToken, ThemeToken])[]

function isThemeTokenName(value: string): value is ThemeToken {
  return Object.hasOwn(themeAuthoringSchema.$defs.lightColors.properties, value)
}

function findSchemaMaximumLength(constraints: readonly object[], field: string): number {
  for (const constraint of constraints) {
    if ("maxLength" in constraint && typeof constraint.maxLength === "number") {
      return constraint.maxLength
    }
  }

  throw new Error(`Theme JSON Schema is missing the ${field} maximum length`)
}

function findSchemaPattern(constraints: readonly object[], field: string): RegExp {
  for (const constraint of constraints) {
    if ("pattern" in constraint && typeof constraint.pattern === "string") {
      return new RegExp(constraint.pattern, "u")
    }
  }

  throw new Error(`Theme JSON Schema is missing the ${field} pattern`)
}

export interface ResolvedThemeColor {
  readonly css: string
  readonly srgb: readonly [number, number, number]
  readonly srgbHex: `#${string}`
}

const themePalettePropertyByToken = Object.freeze({
  background: "background",
  foreground: "foreground",
  card: "card",
  "card-foreground": "cardForeground",
  popover: "popover",
  "popover-foreground": "popoverForeground",
  primary: "primary",
  "primary-foreground": "primaryForeground",
  secondary: "secondary",
  "secondary-foreground": "secondaryForeground",
  muted: "muted",
  "muted-foreground": "mutedForeground",
  accent: "accent",
  "accent-foreground": "accentForeground",
  destructive: "destructive",
  warning: "warning",
  border: "border",
  input: "input",
  ring: "ring",
  "chart-1": "chart1",
  "chart-2": "chart2",
  "chart-3": "chart3",
  "chart-4": "chart4",
  "chart-5": "chart5",
  sidebar: "sidebar",
  "sidebar-foreground": "sidebarForeground",
  "sidebar-primary": "sidebarPrimary",
  "sidebar-primary-foreground": "sidebarPrimaryForeground",
  "sidebar-accent": "sidebarAccent",
  "sidebar-accent-foreground": "sidebarAccentForeground",
  "sidebar-border": "sidebarBorder",
  "sidebar-ring": "sidebarRing",
} as const satisfies Readonly<Record<ThemeToken, string>>)

type ThemePaletteProperty = (typeof themePalettePropertyByToken)[ThemeToken]

export type ResolvedThemePalette = Readonly<Record<ThemePaletteProperty, ResolvedThemeColor>>

function mapThemeTokenValues<Value>(
  mapValue: (token: ThemeToken) => Value,
): Record<ThemeToken, Value> {
  const values: Partial<Record<ThemeToken, Value>> = {}

  for (const token of themeTokenNames) {
    values[token] = mapValue(token)
  }

  if (!hasEveryThemeToken(values)) throw new Error("Unable to map every theme token")
  return values
}

function hasEveryThemeToken<Value>(
  values: Partial<Record<ThemeToken, Value>>,
): values is Record<ThemeToken, Value> {
  return themeTokenNames.every((token) => Object.hasOwn(values, token))
}

const themeColorSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed({ message: "Theme colors must not have surrounding whitespace" })),
  Schema.check(
    Schema.isMaxLength(maximumThemeColorLength, {
      message: `Theme colors must be at most ${maximumThemeColorLength} characters`,
    }),
  ),
  Schema.check(
    Schema.makeFilter(isOpaqueThemeColor, {
      message: "Theme colors must be valid opaque CSS colors",
    }),
  ),
)
const themeColorEntries = mapThemeTokenValues(() => themeColorSchema)
const optionalThemeColor = () => Schema.optionalKey(themeColorSchema)
const optionalThemeColorEntries = mapThemeTokenValues(() => optionalThemeColor())
const themeColorMapSchema = Schema.Struct(themeColorEntries)
const themeRadiusPattern = findSchemaPattern(
  themeAuthoringSchema.$defs.geometry.properties.radius.allOf,
  "theme radius",
)
const themeRadiusSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(maximumThemeRadiusLength, {
      message: `Theme radius must be at most ${maximumThemeRadiusLength} characters`,
    }),
  ),
  Schema.check(
    Schema.isPattern(themeRadiusPattern, {
      message: "Theme radius must be zero or a nonnegative px, rem, em, or percentage length",
    }),
  ),
)

const themeDocumentEffectSchema = Schema.Struct({
  colors: Schema.Struct({
    light: themeColorMapSchema,
    dark: themeColorMapSchema,
  }),
  geometry: Schema.Struct({ radius: themeRadiusSchema }),
}).pipe(
  Schema.check(Schema.makeFilter(findSemanticContrastIssues)),
  Schema.annotate({
    parseOptions: { errors: "all", onExcessProperty: "error" },
  }),
)

const lightThemeDefinitionSchema = Schema.Struct({
  ...optionalThemeColorEntries,
  primary: themeColorSchema,
})
const darkThemeDefinitionSchema = Schema.Struct({
  background: optionalThemeColor(),
  foreground: optionalThemeColor(),
  primary: optionalThemeColor(),
  accent: optionalThemeColor(),
})

const themeDefinitionEffectSchema = Schema.Struct({
  $schema: Schema.optionalKey(Schema.Literal(themeDefinitionSchemaUrl)),
  colors: Schema.Struct({
    light: lightThemeDefinitionSchema,
    dark: Schema.optionalKey(darkThemeDefinitionSchema),
  }),
  geometry: Schema.Struct({
    radius: Schema.optionalKey(themeRadiusSchema),
  }),
}).annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
})

type ThemeDocumentSchema = ReturnType<
  typeof Schema.toStandardSchemaV1<typeof themeDocumentEffectSchema>
>
type ThemeDefinitionSchema = ReturnType<
  typeof Schema.toStandardSchemaV1<typeof themeDefinitionEffectSchema>
>

export const themeDocumentSchema: ThemeDocumentSchema =
  Schema.toStandardSchemaV1(themeDocumentEffectSchema)
export const themeDefinitionSchema: ThemeDefinitionSchema = Schema.toStandardSchemaV1(
  themeDefinitionEffectSchema,
)

export type ThemeColorMap = Schema.Schema.Type<typeof themeColorMapSchema>
export type ThemeDocument = Schema.Schema.Type<typeof themeDocumentEffectSchema>
export type ThemeDefinition = Schema.Schema.Type<typeof themeDefinitionEffectSchema>

export interface ThemeValidationIssue {
  readonly path: readonly (string | number)[]
  readonly message: string
}

export type ThemeCssCompilationResult =
  | { readonly ok: true; readonly css: string }
  | { readonly ok: false; readonly issues: readonly ThemeValidationIssue[] }

const decodeThemeDocument = Schema.decodeUnknownSync(themeDocumentSchema)
const decodeThemeDefinition = Schema.decodeUnknownSync(themeDefinitionSchema)

export function parseThemeDocument(input: unknown): ThemeDocument {
  return decodeThemeDocument(input)
}

export function resolveThemeDefinition(input: unknown): ThemeDocument {
  const definition = decodeThemeDefinition(input)
  const light = resolveLightTheme(definition.colors.light)
  const dark = resolveDarkTheme(light, definition.colors.light, definition.colors.dark)

  return parseThemeDocument({
    colors: { light, dark },
    geometry: { radius: definition.geometry.radius ?? defaultThemeRadius },
  })
}

export function compileThemeCss(input: unknown): ThemeCssCompilationResult {
  try {
    return { ok: true, css: serializeThemeCss(resolveThemeDefinition(input)) }
  } catch (error) {
    if (!Schema.isSchemaError(error)) throw error

    const { issues } = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue)
    return {
      ok: false,
      issues: issues.map(({ message, path = [] }) => ({
        message,
        path: path.map((segment) => normalizeValidationPathSegment(segment)),
      })),
    }
  }
}

export function resolveThemeColor(
  document: ThemeDocument,
  mode: ThemeMode,
  token: ThemeToken,
): ResolvedThemeColor {
  const css = document.colors[mode][token]
  const parsed = parseOpaqueColor(css)

  if (!parsed) throw new Error(`Unsupported theme color: ${css}`)

  const [rawRed, rawGreen, rawBlue] = colorDataToSrgb(parsed)
  const red = Math.round(rawRed)
  const green = Math.round(rawGreen)
  const blue = Math.round(rawBlue)
  const srgb = Object.freeze([red, green, blue] as const)
  const srgbHex =
    `#${srgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}` as const

  return Object.freeze({
    css,
    srgb,
    srgbHex,
  })
}

export function resolveThemePalette(
  document: ThemeDocument,
  mode: ThemeMode,
): ResolvedThemePalette {
  const palette: Partial<Record<ThemePaletteProperty, ResolvedThemeColor>> = {}

  for (const token of themeTokenNames) {
    palette[themePalettePropertyByToken[token]] = resolveThemeColor(document, mode, token)
  }

  if (!hasEveryThemePaletteProperty(palette)) {
    throw new Error("Unable to resolve every theme palette color")
  }

  return Object.freeze(palette)
}

function hasEveryThemePaletteProperty(
  palette: Partial<Record<ThemePaletteProperty, ResolvedThemeColor>>,
): palette is Record<ThemePaletteProperty, ResolvedThemeColor> {
  return themeTokenNames.every((token) =>
    Object.hasOwn(palette, themePalettePropertyByToken[token]),
  )
}

export function generateThemeCss(document: ThemeDocument): string {
  return serializeThemeCss(parseThemeDocument(document))
}

function serializeThemeCss(document: ThemeDocument): string {
  return [
    "/* Generated by @astralbeam/theme. Do not edit. */",
    "",
    ".light,",
    ".dark {",
    `  --radius: ${document.geometry.radius};`,
    "}",
    "",
    ".light {",
    generateColorDeclarations(document.colors.light),
    "}",
    "",
    ".dark {",
    generateColorDeclarations(document.colors.dark),
    "}",
    "",
  ].join("\n")
}

export function themeCssVariables(document: ThemeDocument, mode: ThemeMode): ThemeCssVariables {
  const colors = document.colors[mode]
  const variables: Partial<Record<ThemeCssVariableName, string>> = {
    "--radius": document.geometry.radius,
  }

  for (const token of themeTokenNames) variables[`--${token}`] = colors[token]

  return completeThemeCssVariables(variables)
}

const colorPrecision = 6
const lightSurfaceMixes = {
  secondary: 0.04,
  mutedForeground: 0.52,
  border: 0.09,
  input: 0.09,
} as const

type ThemeDraft = { -readonly [Token in ThemeToken]?: string }
type DerivedLightThemeToken = Exclude<ThemeToken, "primary">
type LightThemeDerivation = (theme: Readonly<ThemeDraft>) => string
interface DarkThemeState {
  readonly authoredLightTokens: Readonly<Partial<Record<ThemeToken, true>>>
  readonly colors: Readonly<ThemeDraft>
  readonly light: ThemeColorMap
}
type DarkThemeDerivation = (theme: Readonly<DarkThemeState>) => string

// Each optional light role is a one-argument derivation over the already-resolved theme draft. Explicit authoring values are inserted first and therefore skip these functions. The semantic role scaffold follows shadcn's token relationships. https://ui.shadcn.com/docs/theming
const lightThemeDerivations = {
  background: () => defaultLightBackground,
  foreground: () => defaultLightForeground,
  card: () => defaultLightCard,
  "card-foreground": (theme) =>
    deriveAccessibleForeground(getThemeColor(theme, "card"), getThemeColor(theme, "foreground")),
  popover: (theme) => getThemeColor(theme, "card"),
  "popover-foreground": (theme) =>
    deriveAccessibleForeground(
      getThemeColor(theme, "popover"),
      getThemeColor(theme, "card-foreground"),
    ),
  "primary-foreground": (theme) =>
    deriveAccessibleForeground(getThemeColor(theme, "primary"), getThemeColor(theme, "background")),
  secondary: (theme) =>
    deriveLightSecondary(getThemeColor(theme, "background"), getThemeColor(theme, "foreground")),
  "secondary-foreground": (theme) =>
    deriveAccessibleForeground(
      getThemeColor(theme, "secondary"),
      getThemeColor(theme, "foreground"),
    ),
  muted: (theme) => getThemeColor(theme, "secondary"),
  "muted-foreground": (theme) =>
    deriveLightMutedForeground(getThemeColor(theme, "muted"), getThemeColor(theme, "foreground")),
  accent: (theme) => getThemeColor(theme, "secondary"),
  "accent-foreground": (theme) =>
    deriveLightAccentForeground(getThemeColor(theme, "accent"), getThemeColor(theme, "foreground")),
  destructive: (theme) =>
    deriveAccessibleForeground(
      getThemeColor(theme, "background"),
      normalizeDerivedColor(defaultLightStatusColors.destructive),
    ),
  warning: (theme) =>
    deriveAccessibleForeground(
      getThemeColor(theme, "background"),
      normalizeDerivedColor(defaultLightStatusColors.warning),
    ),
  border: (theme) =>
    deriveLightBorder(getThemeColor(theme, "background"), getThemeColor(theme, "foreground")),
  input: (theme) =>
    deriveLightInput(getThemeColor(theme, "background"), getThemeColor(theme, "foreground")),
  ring: (theme) =>
    deriveLightRing(getThemeColor(theme, "background"), getThemeColor(theme, "primary")),
  "chart-1": (theme) => getThemeColor(theme, "primary"),
  "chart-2": () => defaultLightChartColors["chart-2"],
  "chart-3": () => defaultLightChartColors["chart-3"],
  "chart-4": () => defaultLightChartColors["chart-4"],
  "chart-5": () => defaultLightChartColors["chart-5"],
  sidebar: (theme) => getThemeColor(theme, "background"),
  "sidebar-foreground": (theme) =>
    deriveAccessibleForeground(getThemeColor(theme, "sidebar"), getThemeColor(theme, "foreground")),
  "sidebar-primary": (theme) => getThemeColor(theme, "primary"),
  "sidebar-primary-foreground": (theme) =>
    deriveAccessibleForeground(
      getThemeColor(theme, "sidebar-primary"),
      getThemeColor(theme, "card"),
    ),
  "sidebar-accent": (theme) => getThemeColor(theme, "accent"),
  "sidebar-accent-foreground": (theme) =>
    deriveLightSidebarAccentForeground(
      getThemeColor(theme, "sidebar-accent"),
      getThemeColor(theme, "accent-foreground"),
    ),
  "sidebar-border": (theme) => getThemeColor(theme, "border"),
  "sidebar-ring": (theme) =>
    deriveAccessibleIndicator(getThemeColor(theme, "sidebar"), getThemeColor(theme, "ring")),
} as const satisfies Record<DerivedLightThemeToken, LightThemeDerivation>

// Material schemes select role-specific tones from palettes generated from source colors. These lambdas apply that model in OKLCH to every resolved light role, with a small fidelity term, then gamut-map and contrast-correct the result. https://github.com/material-foundation/material-color-utilities/blob/main/dev_guide/creating_color_scheme.md
const darkThemeDerivations = {
  background: ({ light }) => deriveOklchTone(light.background, 0.17, 1.4, 0.04),
  foreground: ({ colors, light }) =>
    deriveDarkForeground(getThemeColor(colors, "background"), light.foreground, 0.96, 0.5, 0.04),
  card: (theme) =>
    !isLightTokenAuthored(theme, "card")
      ? deriveElevatedDarkSurface(getThemeColor(theme.colors, "background"), 0.04)
      : deriveOklchTone(theme.light.card, 0.2, 1.3, 0.05),
  "card-foreground": (theme) =>
    !isLightTokenAuthored(theme, "card-foreground")
      ? deriveAccessibleForeground(
          getThemeColor(theme.colors, "card"),
          getThemeColor(theme.colors, "foreground"),
        )
      : deriveDarkForeground(
          getThemeColor(theme.colors, "card"),
          theme.light["card-foreground"],
          0.94,
          0.55,
          0.05,
        ),
  popover: (theme) =>
    !isLightTokenAuthored(theme, "popover")
      ? getThemeColor(theme.colors, "card")
      : deriveOklchTone(theme.light.popover, 0.2, 1.3, 0.05),
  "popover-foreground": (theme) =>
    !isLightTokenAuthored(theme, "popover-foreground")
      ? deriveAccessibleForeground(
          getThemeColor(theme.colors, "popover"),
          getThemeColor(theme.colors, "card-foreground"),
        )
      : deriveDarkForeground(
          getThemeColor(theme.colors, "popover"),
          theme.light["popover-foreground"],
          0.94,
          0.55,
          0.05,
        ),
  primary: ({ light }) => deriveOklchTone(light.primary, 0.78, 1.4, 0.22),
  "primary-foreground": (theme) =>
    !isLightTokenAuthored(theme, "primary-foreground")
      ? deriveAccessibleForeground(
          getThemeColor(theme.colors, "primary"),
          getThemeColor(theme.colors, "background"),
        )
      : deriveDarkForeground(
          getThemeColor(theme.colors, "primary"),
          theme.light["primary-foreground"],
          0.18,
          0.6,
          0.06,
        ),
  secondary: (theme) =>
    !isLightTokenAuthored(theme, "secondary")
      ? deriveElevatedDarkSurface(getThemeColor(theme.colors, "background"), 0.08)
      : deriveOklchTone(theme.light.secondary, 0.25, 1.5, 0.08),
  "secondary-foreground": (theme) =>
    !isLightTokenAuthored(theme, "secondary-foreground")
      ? deriveAccessibleForeground(
          getThemeColor(theme.colors, "secondary"),
          getThemeColor(theme.colors, "foreground"),
        )
      : deriveDarkForeground(
          getThemeColor(theme.colors, "secondary"),
          theme.light["secondary-foreground"],
          0.94,
          0.6,
          0.06,
        ),
  muted: (theme) =>
    !isLightTokenAuthored(theme, "muted")
      ? getThemeColor(theme.colors, "secondary")
      : deriveOklchTone(theme.light.muted, 0.25, 1.5, 0.08),
  "muted-foreground": (theme) =>
    !isLightTokenAuthored(theme, "muted-foreground")
      ? findMutedForeground(
          getThemeColor(theme.colors, "muted"),
          getThemeColor(theme.colors, "foreground"),
          0.73,
        )
      : deriveDarkForeground(
          getThemeColor(theme.colors, "muted"),
          theme.light["muted-foreground"],
          0.76,
          0.75,
          0.08,
        ),
  accent: (theme) =>
    !isLightTokenAuthored(theme, "accent")
      ? getThemeColor(theme.colors, "secondary")
      : deriveOklchTone(theme.light.accent, 0.28, 1.5, 0.12),
  "accent-foreground": (theme) =>
    !isLightTokenAuthored(theme, "accent-foreground")
      ? deriveAccessibleForeground(
          getThemeColor(theme.colors, "accent"),
          getThemeColor(theme.colors, "foreground"),
        )
      : deriveDarkForeground(
          getThemeColor(theme.colors, "accent"),
          theme.light["accent-foreground"],
          0.94,
          0.6,
          0.06,
        ),
  destructive: ({ colors, light }) =>
    deriveAccessibleForeground(
      getThemeColor(colors, "background"),
      deriveOklchTone(light.destructive, 0.7, 0.9, 0.2),
    ),
  warning: ({ colors, light }) =>
    deriveAccessibleForeground(
      getThemeColor(colors, "background"),
      deriveOklchTone(light.warning, 0.82, 0.9, 0.16),
    ),
  border: (theme) =>
    !isLightTokenAuthored(theme, "border")
      ? deriveElevatedDarkSurface(getThemeColor(theme.colors, "background"), 0.14)
      : deriveOklchTone(theme.light.border, 0.31, 1.25, 0.08),
  input: (theme) =>
    !isLightTokenAuthored(theme, "input")
      ? deriveElevatedDarkSurface(getThemeColor(theme.colors, "background"), 0.2)
      : deriveOklchTone(theme.light.input, 0.37, 1.25, 0.09),
  ring: (theme) =>
    deriveAccessibleIndicator(
      getThemeColor(theme.colors, "background"),
      !isLightTokenAuthored(theme, "ring")
        ? deriveOklchTone(getThemeColor(theme.colors, "primary"), 0.82, 1, 0.2)
        : deriveOklchTone(theme.light.ring, 0.8, 1.25, 0.2),
    ),
  "chart-1": (theme) =>
    !isLightTokenAuthored(theme, "chart-1")
      ? getThemeColor(theme.colors, "primary")
      : deriveOklchTone(theme.light["chart-1"], 0.72, 1.05, 0.22),
  "chart-2": ({ light }) => deriveOklchTone(light["chart-2"], 0.72, 1.05, 0.22),
  "chart-3": ({ light }) => deriveOklchTone(light["chart-3"], 0.76, 1.05, 0.22),
  "chart-4": ({ light }) => deriveOklchTone(light["chart-4"], 0.74, 1.05, 0.22),
  "chart-5": ({ light }) => deriveOklchTone(light["chart-5"], 0.8, 1.05, 0.22),
  sidebar: (theme) =>
    !isLightTokenAuthored(theme, "sidebar")
      ? deriveElevatedDarkSurface(getThemeColor(theme.colors, "background"), 0.02)
      : deriveOklchTone(theme.light.sidebar, 0.19, 1.3, 0.05),
  "sidebar-foreground": (theme) =>
    !isLightTokenAuthored(theme, "sidebar-foreground")
      ? deriveAccessibleForeground(
          getThemeColor(theme.colors, "sidebar"),
          getThemeColor(theme.colors, "foreground"),
        )
      : deriveDarkForeground(
          getThemeColor(theme.colors, "sidebar"),
          theme.light["sidebar-foreground"],
          0.94,
          0.55,
          0.05,
        ),
  "sidebar-primary": (theme) =>
    !isLightTokenAuthored(theme, "sidebar-primary")
      ? getThemeColor(theme.colors, "primary")
      : deriveOklchTone(theme.light["sidebar-primary"], 0.72, 1.2, 0.22),
  "sidebar-primary-foreground": (theme) =>
    !isLightTokenAuthored(theme, "sidebar-primary-foreground")
      ? deriveAccessibleForeground(
          getThemeColor(theme.colors, "sidebar-primary"),
          getThemeColor(theme.colors, "card"),
        )
      : deriveDarkForeground(
          getThemeColor(theme.colors, "sidebar-primary"),
          theme.light["sidebar-primary-foreground"],
          0.18,
          0.6,
          0.06,
        ),
  "sidebar-accent": (theme) =>
    !isLightTokenAuthored(theme, "sidebar-accent")
      ? getThemeColor(theme.colors, "accent")
      : deriveOklchTone(theme.light["sidebar-accent"], 0.25, 1.5, 0.12),
  "sidebar-accent-foreground": (theme) =>
    !isLightTokenAuthored(theme, "sidebar-accent-foreground")
      ? deriveAccessibleForeground(
          getThemeColor(theme.colors, "sidebar-accent"),
          getThemeColor(theme.colors, "accent-foreground"),
        )
      : deriveDarkForeground(
          getThemeColor(theme.colors, "sidebar-accent"),
          theme.light["sidebar-accent-foreground"],
          0.94,
          0.6,
          0.06,
        ),
  "sidebar-border": (theme) =>
    !isLightTokenAuthored(theme, "sidebar-border")
      ? getThemeColor(theme.colors, "border")
      : deriveOklchTone(theme.light["sidebar-border"], 0.31, 1.25, 0.08),
  "sidebar-ring": (theme) =>
    deriveAccessibleIndicator(
      getThemeColor(theme.colors, "sidebar"),
      !isLightTokenAuthored(theme, "sidebar-ring")
        ? getThemeColor(theme.colors, "ring")
        : deriveOklchTone(theme.light["sidebar-ring"], 0.8, 1.25, 0.2),
    ),
} as const satisfies Record<ThemeToken, DarkThemeDerivation>

const themeDerivationTokenNames = Object.freeze({
  light: Object.freeze(themeTokenNames.filter(isDerivedLightThemeToken)),
  dark: Object.freeze([...themeTokenNames]),
})

function isDerivedLightThemeToken(token: ThemeToken): token is DerivedLightThemeToken {
  return token !== "primary"
}

function resolveLightTheme(input: ThemeDefinition["colors"]["light"]): ThemeColorMap {
  const colors: ThemeDraft = { ...input }

  for (const token of themeDerivationTokenNames.light) {
    colors[token] ??= lightThemeDerivations[token](colors)
  }

  return completeThemeColorMap(colors)
}

function resolveDarkTheme(
  light: ThemeColorMap,
  lightInput: ThemeDefinition["colors"]["light"],
  input: ThemeDefinition["colors"]["dark"] = {},
): ThemeColorMap {
  const colors: ThemeDraft = { ...input }
  const authoredLightTokens: Partial<Record<ThemeToken, true>> = {}
  for (const token of themeTokenNames) {
    if (Object.hasOwn(lightInput, token)) authoredLightTokens[token] = true
  }
  const theme: DarkThemeState = { authoredLightTokens, colors, light }

  for (const token of themeDerivationTokenNames.dark) {
    colors[token] ??= darkThemeDerivations[token](theme)
  }

  return completeThemeColorMap(colors)
}

function isLightTokenAuthored(theme: DarkThemeState, token: ThemeToken): boolean {
  return theme.authoredLightTokens[token] === true
}

function completeThemeColorMap(colors: ThemeDraft): ThemeColorMap {
  return mapThemeTokenValues((token) => {
    const colorValue = colors[token]
    if (!colorValue) throw new Error(`Missing derived theme color: ${token}`)
    return colorValue
  })
}

function getThemeColor(colors: Readonly<ThemeDraft>, token: ThemeToken): string {
  const colorValue = colors[token]
  if (!colorValue) throw new Error(`Theme derivation ${token} ran before its dependency`)
  return colorValue
}

function deriveOklchTone(
  sourceColor: string,
  targetLightness: number,
  chromaScale: number,
  maximumChroma: number,
): string {
  const [lightness, chroma, hue] = toOklch(sourceColor)
  const fidelityLightness = clamp(
    targetLightness + (lightness - 0.5) * 0.02,
    targetLightness - 0.015,
    targetLightness + 0.015,
  )
  return formatOklch(fidelityLightness, Math.min(chroma * chromaScale, maximumChroma), hue)
}

function deriveDarkForeground(
  surface: string,
  lightForeground: string,
  targetLightness: number,
  chromaScale: number,
  maximumChroma: number,
): string {
  const [, chroma, hue] = toOklch(lightForeground)
  const preferred = formatOklch(targetLightness, Math.min(chroma * chromaScale, maximumChroma), hue)
  return deriveAccessibleForeground(surface, preferred)
}

function deriveLightRing(background: string, primary: string): string {
  return deriveAccessibleIndicator(background, deriveOklchTone(primary, 0.63, 1.25, 0.2))
}

function deriveLightSecondary(background: string, foreground: string): string {
  return mixSurfaceWithContrast(background, foreground, lightSurfaceMixes.secondary)
}

function deriveLightBorder(background: string, foreground: string): string {
  return mixOklchColors(background, foreground, lightSurfaceMixes.border)
}

function deriveLightInput(background: string, foreground: string): string {
  return mixOklchColors(background, foreground, lightSurfaceMixes.input)
}

function deriveLightMutedForeground(muted: string, foreground: string): string {
  return findMutedForeground(muted, foreground, lightSurfaceMixes.mutedForeground)
}

function deriveLightAccentForeground(accent: string, foreground: string): string {
  return deriveAccessibleForeground(accent, foreground)
}

function deriveLightSidebarAccentForeground(
  sidebarAccent: string,
  accentForeground: string,
): string {
  return deriveAccessibleForeground(sidebarAccent, accentForeground)
}

function deriveElevatedDarkSurface(background: string, lightnessIncrease: number): string {
  const [lightness, chroma, hue] = toOklch(background)
  return formatOklch(lightness + lightnessIncrease, chroma * 1.2, hue)
}

function deriveAccessibleForeground(surface: string, preferred: string): string {
  return deriveAccessibleColor(surface, preferred, derivedTextContrast)
}

function deriveAccessibleIndicator(surface: string, preferred: string): string {
  return deriveAccessibleColor(surface, preferred, derivedNonTextContrast)
}

function deriveAccessibleColor(surface: string, preferred: string, targetContrast: number): string {
  if (contrastRatio(surface, preferred) >= targetContrast) return preferred

  const [preferredLightness, preferredChroma, preferredHue] = toOklch(preferred)
  const darker = findContrastingTone(
    surface,
    preferredLightness,
    preferredChroma,
    preferredHue,
    0,
    targetContrast,
  )
  const lighter = findContrastingTone(
    surface,
    preferredLightness,
    preferredChroma,
    preferredHue,
    1,
    targetContrast,
  )

  if (!darker) {
    if (!lighter) throw new Error(`Unable to derive ${targetContrast}:1 contrast`)
    return lighter
  }
  if (!lighter) return darker

  const darkerDistance = Math.abs(toOklch(darker)[0] - preferredLightness)
  const lighterDistance = Math.abs(toOklch(lighter)[0] - preferredLightness)
  return darkerDistance <= lighterDistance ? darker : lighter
}

function findContrastingTone(
  surface: string,
  preferredLightness: number,
  chroma: number,
  hue: number,
  endpointLightness: 0 | 1,
  targetContrast: number,
): string | undefined {
  const endpoint = formatOklch(endpointLightness, chroma, hue)
  if (contrastRatio(surface, endpoint) < targetContrast) return undefined

  let passingLightness: number = endpointLightness
  let failingLightness = preferredLightness

  for (let iteration = 0; iteration < 48; iteration += 1) {
    const candidateLightness = (passingLightness + failingLightness) / 2
    const candidate = formatOklch(candidateLightness, chroma, hue)

    if (contrastRatio(surface, candidate) >= targetContrast) {
      passingLightness = candidateLightness
    } else {
      failingLightness = candidateLightness
    }
  }

  return formatOklch(passingLightness, chroma, hue)
}

function mixOklchColors(
  background: string,
  foreground: string,
  foregroundContribution: number,
): string {
  return formatOklchMix(toOklch(background), toOklch(foreground), foregroundContribution)
}

function mixSurfaceWithContrast(
  background: string,
  foreground: string,
  preferredForegroundContribution: number,
): string {
  const backgroundOklch = toOklch(background)
  const foregroundOklch = toOklch(foreground)
  const preferred = formatOklchMix(
    backgroundOklch,
    foregroundOklch,
    preferredForegroundContribution,
  )

  if (contrastRatio(preferred, foreground) >= minimumTextContrast) return preferred

  let lowerContribution = 0
  let upperContribution = preferredForegroundContribution

  for (let iteration = 0; iteration < 48; iteration += 1) {
    const contribution = (lowerContribution + upperContribution) / 2
    const candidate = formatOklchMix(backgroundOklch, foregroundOklch, contribution)

    if (contrastRatio(candidate, foreground) >= minimumTextContrast) {
      lowerContribution = contribution
    } else {
      upperContribution = contribution
    }
  }

  return formatOklchMix(backgroundOklch, foregroundOklch, lowerContribution)
}

function formatOklchMix(
  background: readonly [number, number, number],
  foreground: readonly [number, number, number],
  foregroundContribution: number,
): string {
  const [backgroundLightness, backgroundChroma, backgroundHue] = background
  const [foregroundLightness, foregroundChroma, foregroundHue] = foreground
  const lightness = interpolate(backgroundLightness, foregroundLightness, foregroundContribution)
  const chroma = interpolate(backgroundChroma, foregroundChroma, foregroundContribution)
  const hue = interpolateOklchHue(
    backgroundHue,
    foregroundHue,
    backgroundChroma,
    foregroundChroma,
    foregroundContribution,
  )

  return formatOklch(lightness, chroma, hue)
}

function normalizeDerivedColor(colorValue: string): string {
  const [lightness, chroma, hue] = toOklch(colorValue)
  return formatOklch(lightness, chroma, hue)
}

function findMutedForeground(
  background: string,
  foreground: string,
  preferredForegroundContribution: number,
): string {
  const backgroundOklch = toOklch(background)
  const foregroundOklch = toOklch(foreground)
  const preferred = formatOklchMix(
    backgroundOklch,
    foregroundOklch,
    preferredForegroundContribution,
  )

  if (contrastRatio(background, preferred) >= minimumTextContrast) return preferred

  const endpointContrast = contrastRatio(background, foreground)
  if (endpointContrast < minimumTextContrast) {
    return deriveAccessibleForeground(background, preferred)
  }

  const targetContrast = Math.min(endpointContrast, minimumTextContrast + 0.000_001)
  let lowerContribution = 0
  let upperContribution = 1

  for (let iteration = 0; iteration < 48; iteration += 1) {
    const contribution = (lowerContribution + upperContribution) / 2
    const candidate = formatOklchMix(backgroundOklch, foregroundOklch, contribution)

    if (contrastRatio(background, candidate) >= targetContrast) {
      upperContribution = contribution
    } else {
      lowerContribution = contribution
    }
  }

  const candidate = formatOklchMix(backgroundOklch, foregroundOklch, upperContribution)
  return contrastRatio(background, candidate) >= minimumTextContrast ? candidate : foreground
}

function findSemanticContrastIssues(document: {
  colors: { light: ThemeColorMap; dark: ThemeColorMap }
  geometry: { radius: string }
}): boolean | readonly { readonly path: readonly PropertyKey[]; readonly issue: string }[] {
  try {
    const issues: { readonly path: readonly PropertyKey[]; readonly issue: string }[] = []

    for (const mode of ["light", "dark"] as const) {
      const colors = document.colors[mode]

      for (const [surface, foreground] of [...foregroundPairs, ...standaloneForegroundPairs]) {
        if (contrastRatio(colors[surface], colors[foreground]) < minimumTextContrast) {
          issues.push({
            path: ["colors", mode, foreground],
            issue: `${mode}.${foreground} must have at least ${minimumTextContrast}:1 contrast against ${mode}.${surface}`,
          })
        }
      }

      for (const [surface, indicator] of nonTextContrastPairs) {
        if (contrastRatio(colors[surface], colors[indicator]) < minimumNonTextContrast) {
          issues.push({
            path: ["colors", mode, indicator],
            issue: `${mode}.${indicator} focus indicators must have at least ${minimumNonTextContrast}:1 contrast against ${mode}.${surface}`,
          })
        }
      }
    }

    return issues.length === 0 ? true : issues
  } catch {
    return false
  }
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(colorValue: string): number {
  const parsed = parseOpaqueColor(colorValue)
  if (!parsed) throw new Error(`Unsupported theme color: ${colorValue}`)

  const [red, green, blue] = colorDataToSrgb(parsed)
  return 0.2126 * linearizeSrgb(red) + 0.7152 * linearizeSrgb(green) + 0.0722 * linearizeSrgb(blue)
}

function linearizeSrgb(channel: number): number {
  const normalized = clamp(channel / 255, 0, 1)
  return normalized <= 0.040_45 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function toOklch(colorValue: string): [number, number, number] {
  const parsed = parseOpaqueColor(colorValue)
  if (!parsed) throw new Error(`Unsupported theme color: ${colorValue}`)

  return colorDataToOklch(parsed)
}

function formatOklch(lightness: number, chroma: number, hue: number): string {
  const mapped = mapOklchToSrgb(clamp(lightness, 0, 1), Math.max(chroma, 0), normalizeHue(hue))
  const serializedLightness = roundColorNumber(mapped[0])
  const serializedHue = roundColorNumber(normalizeHue(mapped[2]))
  const serializedChroma = roundChromaIntoSrgbGamut(serializedLightness, mapped[1], serializedHue)
  return `oklch(${serializedLightness} ${serializedChroma} ${serializedHue})`
}

// CSS Color 4 local-MINDE mapping preserves perceptually equivalent clipped colors and reduces chroma only when clipping would exceed the 0.02 ΔEOK just-noticeable difference. https://www.w3.org/TR/css-color-4/#binsearch
function mapOklchToSrgb(
  lightness: number,
  chroma: number,
  hue: number,
): readonly [number, number, number] {
  if (lightness >= 1) return [1, 0, hue]
  if (lightness <= 0) return [0, 0, hue]
  if (isOklchInSrgbGamut(lightness, chroma, hue)) return [lightness, chroma, hue]

  let lowerChroma = 0
  let upperChroma = chroma
  let lowerIsInGamut = true
  let clipped = clipOklchToSrgb(lightness, chroma, hue)

  if (deltaEOK([lightness, chroma, hue], clipped) < justNoticeableDeltaE) return clipped

  while (upperChroma - lowerChroma > gamutMappingEpsilon) {
    const candidateChroma = (lowerChroma + upperChroma) / 2

    if (lowerIsInGamut && isOklchInSrgbGamut(lightness, candidateChroma, hue)) {
      lowerChroma = candidateChroma
      continue
    }

    clipped = clipOklchToSrgb(lightness, candidateChroma, hue)
    const difference = deltaEOK([lightness, candidateChroma, hue], clipped)

    if (difference < justNoticeableDeltaE) {
      if (justNoticeableDeltaE - difference < gamutMappingEpsilon) return clipped
      lowerIsInGamut = false
      lowerChroma = candidateChroma
    } else {
      upperChroma = candidateChroma
    }
  }

  return clipped
}

function clipOklchToSrgb(
  lightness: number,
  chroma: number,
  hue: number,
): readonly [number, number, number] {
  const [red, green, blue] = oklchToLinearSrgb(lightness, chroma, hue).map((channel) =>
    linearSrgbToSrgb(clamp(channel, 0, 1)),
  )
  const [clippedLightness, clippedChroma, clippedHue] = toOklch(
    `color(srgb ${red} ${green} ${blue})`,
  )

  return [
    clamp(clippedLightness, 0, 1),
    Math.max(clippedChroma, 0),
    typeof clippedHue === "number" && Number.isFinite(clippedHue) ? normalizeHue(clippedHue) : hue,
  ]
}

function deltaEOK(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  const [firstLightness, firstChroma, firstHue] = first
  const [secondLightness, secondChroma, secondHue] = second
  const firstHueRadians = (firstHue * Math.PI) / 180
  const secondHueRadians = (secondHue * Math.PI) / 180

  return Math.hypot(
    firstLightness - secondLightness,
    firstChroma * Math.cos(firstHueRadians) - secondChroma * Math.cos(secondHueRadians),
    firstChroma * Math.sin(firstHueRadians) - secondChroma * Math.sin(secondHueRadians),
  )
}

function linearSrgbToSrgb(channel: number): number {
  return channel <= 0.003_130_8 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
}

function roundChromaIntoSrgbGamut(lightness: number, chroma: number, hue: number): number {
  const colorScale = 10 ** colorPrecision
  let chromaUnits = Math.floor(chroma * colorScale)

  while (chromaUnits > 0 && !isOklchInSrgbGamut(lightness, chromaUnits / colorScale, hue)) {
    chromaUnits -= 1
  }

  return chromaUnits / colorScale
}

function isOklchInSrgbGamut(lightness: number, chroma: number, hue: number): boolean {
  return oklchToLinearSrgb(lightness, chroma, hue).every((channel) => channel >= 0 && channel <= 1)
}

function oklchToLinearSrgb(
  lightness: number,
  chroma: number,
  hue: number,
): readonly [number, number, number] {
  const hueRadians = (normalizeHue(hue) * Math.PI) / 180
  const a = chroma * Math.cos(hueRadians)
  const b = chroma * Math.sin(hueRadians)
  const lPrime = lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b
  const mPrime = lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b
  const sPrime = lightness - 0.089_484_177_5 * a - 1.291_485_548 * b
  const l = lPrime ** 3
  const m = mPrime ** 3
  const s = sPrime ** 3
  const red = 4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s
  const green = -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s
  const blue = -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s
  return [red, green, blue]
}

function roundColorNumber(value: number): number {
  const rounded = Number(value.toFixed(colorPrecision))
  return Object.is(rounded, -0) ? 0 : rounded
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function interpolateOklchHue(
  backgroundHue: number,
  foregroundHue: number,
  backgroundChroma: number,
  foregroundChroma: number,
  foregroundContribution: number,
): number {
  if (backgroundChroma === 0) return foregroundHue
  if (foregroundChroma === 0) return backgroundHue

  const hueDelta = ((foregroundHue - backgroundHue + 540) % 360) - 180
  return normalizeHue(backgroundHue + hueDelta * foregroundContribution)
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function generateColorDeclarations(colors: ThemeColorMap): string {
  return themeTokenNames.map((token) => `  --${token}: ${colors[token]};`).join("\n")
}

function completeThemeCssVariables(
  variables: Partial<Record<ThemeCssVariableName, string>>,
): ThemeCssVariables {
  if (!hasEveryThemeCssVariable(variables)) {
    throw new Error("Unable to map every theme CSS variable")
  }
  return Object.freeze(variables)
}

function hasEveryThemeCssVariable(
  variables: Partial<Record<ThemeCssVariableName, string>>,
): variables is Record<ThemeCssVariableName, string> {
  return (
    Object.hasOwn(variables, "--radius") &&
    themeTokenNames.every((token) => Object.hasOwn(variables, `--${token}`))
  )
}

function normalizeValidationPathSegment(segment: unknown): string | number {
  const key =
    typeof segment === "object" && segment !== null && "key" in segment ? segment.key : segment

  if (typeof key === "string" || typeof key === "number") return key
  return String(key)
}

function isOpaqueThemeColor(value: string): boolean {
  if (value.length > maximumThemeColorLength || value.trim() !== value) return false

  try {
    const parsed = parseOpaqueColor(value)
    if (!parsed) return false

    colorDataToSrgb(parsed)
    colorDataToOklch(parsed)
    return true
  } catch {
    return false
  }
}

function parseOpaqueColor(value: string): ColorData | undefined {
  let hasParseError = false
  const onParseError = () => {
    hasParseError = true
  }
  const components = parseListOfComponentValues(tokenize({ css: value }, { onParseError }), {
    onParseError,
  })
  const component = components[0]
  if (hasParseError || components.length !== 1 || !component) return undefined

  const parsed = color(component)
  if (
    parsed === false ||
    parsed.alpha !== 1 ||
    parsed.syntaxFlags.has(SyntaxFlag.HasNoneKeywords) ||
    !parsed.channels.every(Number.isFinite)
  ) {
    return undefined
  }

  return parsed
}

function colorDataToSrgb(parsed: ColorData): readonly [number, number, number] {
  const [red, green, blue] = clip(XYZ_D65_to_sRGB(colorDataToXyzD65(parsed)))
  return [red * 255, green * 255, blue * 255]
}

function colorDataToOklch(parsed: ColorData): [number, number, number] {
  const [lightness, chroma, convertedHue] =
    parsed.colorNotation === ColorNotation.OKLCH
      ? parsed.channels
      : XYZ_D65_to_OKLCH(colorDataToXyzD65(parsed))
  const hue = Number.isFinite(convertedHue) ? convertedHue : chroma <= 0.000_004 ? 0 : Number.NaN

  if (![lightness, chroma, hue].every(Number.isFinite)) {
    throw new Error("Theme color must have finite OKLCH components")
  }

  return [lightness, chroma, normalizeHue(hue)]
}

function colorDataToXyzD65(parsed: ColorData): Color {
  switch (parsed.colorNotation) {
    case ColorNotation.A98_RGB:
      return a98_RGB_to_XYZ_D65(parsed.channels)
    case ColorNotation.Display_P3:
      return P3_to_XYZ_D65(parsed.channels)
    case ColorNotation.Linear_Display_P3:
      return lin_P3_to_XYZ_D65(parsed.channels)
    case ColorNotation.HEX:
    case ColorNotation.RGB:
    case ColorNotation.sRGB:
      return sRGB_to_XYZ_D65(parsed.channels)
    case ColorNotation.HSL:
      return HSL_to_XYZ_D65(parsed.channels)
    case ColorNotation.HWB:
      return HWB_to_XYZ_D65(parsed.channels)
    case ColorNotation.LCH:
      return LCH_to_XYZ_D65(parsed.channels)
    case ColorNotation.Lab:
      return Lab_to_XYZ_D65(parsed.channels)
    case ColorNotation.Linear_sRGB:
      return lin_sRGB_to_XYZ_D65(parsed.channels)
    case ColorNotation.OKLCH:
      return OKLCH_to_XYZ_D65(parsed.channels)
    case ColorNotation.OKLab:
      return OKLab_to_XYZ_D65(parsed.channels)
    case ColorNotation.ProPhoto_RGB:
      return ProPhoto_RGB_to_XYZ_D65(parsed.channels)
    case ColorNotation.Rec2020:
      return rec_2020_to_XYZ_D65(parsed.channels)
    case ColorNotation.XYZ_D50:
      return XYZ_D50_to_XYZ_D65(parsed.channels)
    case ColorNotation.XYZ_D65:
      return parsed.channels
  }

  throw new Error("Unsupported theme color notation")
}
