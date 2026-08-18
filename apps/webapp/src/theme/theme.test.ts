import { color, ColorNotation, serializeRGB } from "@csstools/css-color-parser"
import { isTokenNode, parseComponentValue } from "@csstools/css-parser-algorithms"
import { isTokenNumber, tokenize } from "@csstools/css-tokenizer"
import { Exit, Schema } from "effect"
import { describe, expect, test } from "vite-plus/test"

import {
  compileThemeCss,
  defaultThemeRadius,
  generateThemeCss,
  parseThemeDocument,
  resolveThemeColor,
  resolveThemeDefinition,
  resolveThemePalette,
  themeCssVariables,
  themeDefinitionSchema,
  themeDefinitionSchemaUrl,
  themeDocumentSchema,
  themeTokenNames,
  type ThemeDefinition,
  type ThemeDocument,
  type ThemeToken,
} from "./theme.ts"

const paletteTokenByProperty = {
  background: "background",
  foreground: "foreground",
  card: "card",
  cardForeground: "card-foreground",
  popover: "popover",
  popoverForeground: "popover-foreground",
  primary: "primary",
  primaryForeground: "primary-foreground",
  secondary: "secondary",
  secondaryForeground: "secondary-foreground",
  muted: "muted",
  mutedForeground: "muted-foreground",
  accent: "accent",
  accentForeground: "accent-foreground",
  destructive: "destructive",
  warning: "warning",
  border: "border",
  input: "input",
  ring: "ring",
  chart1: "chart-1",
  chart2: "chart-2",
  chart3: "chart-3",
  chart4: "chart-4",
  chart5: "chart-5",
  sidebar: "sidebar",
  sidebarForeground: "sidebar-foreground",
  sidebarPrimary: "sidebar-primary",
  sidebarPrimaryForeground: "sidebar-primary-foreground",
  sidebarAccent: "sidebar-accent",
  sidebarAccentForeground: "sidebar-accent-foreground",
  sidebarBorder: "sidebar-border",
  sidebarRing: "sidebar-ring",
} as const

function createThemeDefinition(): ThemeDefinition {
  return {
    colors: {
      light: {
        background: "#ffffff",
        foreground: "#111111",
        primary: "#006b66",
      },
    },
    geometry: { radius: "0.5rem" },
  }
}

function createOrganizationTheme(): ThemeDocument {
  return parseThemeDocument({
    colors: {
      light: createColorMap("#123456", "#ffffff"),
      dark: createColorMap("#abcdef", "#000000"),
    },
    geometry: { radius: "0.75rem" },
  })
}

function createColorMap(surface: string, foreground: string) {
  return Object.fromEntries(
    themeTokenNames.map((token) => [
      token,
      token === "foreground" ||
      token === "destructive" ||
      token === "ring" ||
      token === "sidebar-ring" ||
      token === "warning" ||
      token.endsWith("-foreground")
        ? foreground
        : surface,
    ]),
  )
}

describe("theme document schema", () => {
  test("accepts an exhaustive non-AstralBeam theme", () => {
    const parsed = parseThemeDocument(createOrganizationTheme())

    expect(Object.keys(parsed)).toEqual(["colors", "geometry"])
    expect(Object.keys(parsed.colors.light)).toEqual(themeTokenNames)
    expect(Object.keys(parsed.colors.dark)).toEqual(themeTokenNames)
    expect(parsed.geometry.radius).toBe("0.75rem")
  })

  test("requires the exact resolved structure and semantic token set", () => {
    const organizationTheme = createOrganizationTheme()
    const missingToken = { ...organizationTheme.colors.light } as Record<string, string>
    delete missingToken.background

    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: { ...organizationTheme.colors, light: missingToken },
      }),
    ).toThrow(/background/u)

    const documentsWithExtras = [
      { ...organizationTheme, metadata: "organization-aurora" },
      {
        ...organizationTheme,
        colors: { ...organizationTheme.colors, organizationMode: "organization" },
      },
      {
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          light: { ...organizationTheme.colors.light, "organization-light": "#000000" },
        },
      },
      {
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          dark: { ...organizationTheme.colors.dark, "organization-dark": "#000000" },
        },
      },
      {
        ...organizationTheme,
        geometry: { ...organizationTheme.geometry, density: "compact" },
      },
    ]

    for (const document of documentsWithExtras) {
      expect(Exit.isFailure(Schema.decodeUnknownExit(themeDocumentSchema)(document))).toBe(true)
    }
    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          dark: { ...organizationTheme.colors.dark, "organization-only": "#000000" },
        },
      }),
    ).toThrow(/organization-only/u)
  })

  test("rejects unsafe radius values", () => {
    const organizationTheme = createOrganizationTheme()

    expect(() =>
      parseThemeDocument({ ...organizationTheme, geometry: { radius: "calc(1rem + 1px)" } }),
    ).toThrow("Theme radius must be zero or a nonnegative px, rem, em, or percentage length")
    expect(() =>
      parseThemeDocument({ ...organizationTheme, geometry: { radius: "1rem; color: red" } }),
    ).toThrow("Theme radius must be zero or a nonnegative px, rem, em, or percentage length")
  })

  test("rejects invalid and transparent color values without throwing from safeParse", () => {
    const organizationTheme = createOrganizationTheme()
    const malformedTheme = {
      ...organizationTheme,
      colors: {
        ...organizationTheme.colors,
        light: { ...organizationTheme.colors.light, primary: "color(display-p3" },
      },
    }

    const safelyDecodeMalformedTheme = () =>
      Schema.decodeUnknownExit(themeDocumentSchema)(malformedTheme)

    expect(safelyDecodeMalformedTheme).not.toThrow()
    expect(Exit.isFailure(safelyDecodeMalformedTheme())).toBe(true)
    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          light: { ...organizationTheme.colors.light, primary: "not-a-color" },
        },
      }),
    ).toThrow("Theme colors must be valid opaque CSS colors")
    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          dark: { ...organizationTheme.colors.dark, primary: "rgb(0 0 0 / 50%)" },
        },
      }),
    ).toThrow("Theme colors must be valid opaque CSS colors")
    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          dark: { ...organizationTheme.colors.dark, primary: "rgb(0 0 0 / 99.95%)" },
        },
      }),
    ).toThrow("Theme colors must be valid opaque CSS colors")
    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          dark: {
            ...organizationTheme.colors.dark,
            primary: "color-mix(in srgb, transparent 0.05%, black)",
          },
        },
      }),
    ).toThrow("Theme colors must be valid opaque CSS colors")
  })

  test("rejects low-contrast foreground pairs in resolved documents", () => {
    const organizationTheme = createOrganizationTheme()
    const lowContrastTheme = {
      ...organizationTheme,
      colors: {
        ...organizationTheme.colors,
        light: {
          ...organizationTheme.colors.light,
          "primary-foreground": organizationTheme.colors.light.primary,
        },
      },
    }

    expect(() => parseThemeDocument(lowContrastTheme)).toThrow(/contrast/u)
    expect(() => Schema.decodeUnknownSync(themeDocumentSchema)(lowContrastTheme)).toThrow(
      /contrast/u,
    )

    for (const token of ["destructive", "warning"] as const) {
      expect(() =>
        parseThemeDocument({
          ...organizationTheme,
          colors: {
            ...organizationTheme.colors,
            light: {
              ...organizationTheme.colors.light,
              [token]: organizationTheme.colors.light.background,
            },
          },
        }),
      ).toThrow(/contrast/u)
    }

    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          light: {
            ...organizationTheme.colors.light,
            ring: organizationTheme.colors.light.background,
          },
        },
      }),
    ).toThrow(/focus indicators/u)
  })
})

describe("theme color and CSS utilities", () => {
  test("resolves a selected mode and token to opaque sRGB", () => {
    const resolved = resolveThemeColor(createOrganizationTheme(), "dark", "primary")

    expect(resolved).toEqual({
      css: "#abcdef",
      srgb: [171, 205, 239],
      srgbHex: "#abcdef",
    })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.srgb)).toBe(true)
  })

  test("resolves every token into a reusable mode palette", () => {
    const organizationTheme = createOrganizationTheme()
    const before = JSON.stringify(organizationTheme)
    const palette = resolveThemePalette(organizationTheme, "dark")

    expect(Object.keys(palette)).toEqual(Object.keys(paletteTokenByProperty))
    expect(Object.values(palette)).toEqual(
      Object.values(paletteTokenByProperty).map((token) =>
        resolveThemeColor(organizationTheme, "dark", token),
      ),
    )
    expect(Object.isFrozen(palette)).toBe(true)
    expect(Object.values(palette).every((resolvedColor) => Object.isFrozen(resolvedColor))).toBe(
      true,
    )
    expect(resolveThemePalette(organizationTheme, "dark")).not.toBe(palette)
    expect(JSON.stringify(organizationTheme)).toBe(before)
  })

  test("generates deterministic light and dark CSS", () => {
    const css = generateThemeCss(createOrganizationTheme())

    expect(css).toMatch(/^\/\* Generated by the AstralBeam theme module\. Do not edit\. \*\//u)
    expect(css).toContain(".light,\n.dark {\n  --radius: 0.75rem;\n}")
    expect(css).toContain(".light {\n  --background: #123456;")
    expect(css).toContain(".dark {\n  --background: #abcdef;")
    expect(css.match(/^  --/gmu)).toHaveLength(themeTokenNames.length * 2 + 1)
    expect(css.endsWith("\n")).toBe(true)
  })

  test("creates every CSS variable without mutating the document", () => {
    const organizationTheme = createOrganizationTheme()
    const before = JSON.stringify(organizationTheme)
    const variables = themeCssVariables(organizationTheme, "light")

    expect(Object.keys(variables)).toHaveLength(themeTokenNames.length + 1)
    expect(variables["--radius"]).toBe("0.75rem")
    expect(variables["--primary"]).toBe("#123456")
    expect(Object.isFrozen(variables)).toBe(true)
    expect(JSON.stringify(organizationTheme)).toBe(before)
  })

  test("runtime-validates resolved documents before serializing CSS", () => {
    const organizationTheme = createOrganizationTheme()
    const maliciousTheme = {
      ...organizationTheme,
      colors: {
        ...organizationTheme.colors,
        light: {
          ...organizationTheme.colors.light,
          primary: "red; } body { color: lime",
        },
      },
    }

    expect(() => generateThemeCss(maliciousTheme)).toThrow(
      "Theme colors must be valid opaque CSS colors",
    )
    expect(() =>
      generateThemeCss({
        ...organizationTheme,
        geometry: { radius: "1rem; } body { color: lime" },
      }),
    ).toThrow("Theme radius must be zero or a nonnegative px, rem, em, or percentage length")
  })
})

describe("theme definitions", () => {
  test("safely compiles untrusted compact definitions into deterministic CSS", () => {
    const definition = Object.freeze({
      colors: Object.freeze({
        light: Object.freeze({ primary: "#006b66" }),
      }),
      geometry: Object.freeze({}),
    })
    const expected = generateThemeCss(resolveThemeDefinition(definition))
    const first = compileThemeCss(definition)
    const second = compileThemeCss({ geometry: {}, colors: { light: { primary: "#006b66" } } })

    expect(first).toEqual({ ok: true, css: expected })
    expect(second).toEqual(first)
  })

  test("returns serializable validation issues for unsafe endpoint input", () => {
    const unsafeDefinitions = [
      {
        colors: { light: { primary: "red; } body { color: lime" } },
        geometry: {},
        expectedPath: ["colors", "light", "primary"],
      },
      {
        colors: { light: { primary: "red; --injected: lime" } },
        geometry: {},
        expectedPath: ["colors", "light", "primary"],
      },
      {
        colors: { light: { primary: "red/**/; --injected: lime" } },
        geometry: {},
        expectedPath: ["colors", "light", "primary"],
      },
      {
        colors: { light: { primary: "rgb(255 0 0))" } },
        geometry: {},
        expectedPath: ["colors", "light", "primary"],
      },
      {
        colors: { light: { primary: "#006b66" } },
        geometry: { radius: "1rem; } body { color: lime" },
        expectedPath: ["geometry", "radius"],
      },
      {
        colors: { light: { primary: `red${" ".repeat(254)}` } },
        geometry: {},
        expectedPath: ["colors", "light", "primary"],
      },
      {
        colors: { light: { primary: "#006b66", foreground: "#aaaaaa" } },
        geometry: {},
        expectedPath: ["colors", "light", "foreground"],
      },
    ] as const

    for (const { expectedPath, ...definition } of unsafeDefinitions) {
      const result = compileThemeCss(definition)

      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.issues.length).toBeGreaterThan(0)
      expect(
        result.issues.some((issue) => JSON.stringify(issue.path) === JSON.stringify(expectedPath)),
      ).toBe(true)
      expect(JSON.stringify(result)).not.toMatch(/body \{ color: lime|--injected/iu)
    }
  })

  test("expands one required light color into exact light and derived dark maps", () => {
    const resolved = resolveThemeDefinition({
      colors: { light: { primary: "#006b66" } },
      geometry: {},
    })

    expect(Object.keys(resolved)).toEqual(["colors", "geometry"])
    expect(Object.keys(resolved.colors.light)).toEqual(themeTokenNames)
    expect(Object.keys(resolved.colors.dark)).toEqual(themeTokenNames)
    expect(resolved.colors.light.background).toBe("oklch(1 0 0)")
    expect(resolved.colors.light.foreground).toBe("oklch(0.145 0 0)")
    expect(resolved.colors.light.card).toBe("oklch(1 0 0)")
    expect(resolved.colors.light.popover).toBe(resolved.colors.light.card)
    expect(resolved.colors.light["card-foreground"]).toBe("oklch(0.145 0 0)")
    expect(resolved.colors.light["sidebar-primary-foreground"]).toBe(resolved.colors.light.card)
    expect(resolved.colors.light.accent).toBe(resolved.colors.light.secondary)
    expect(resolved.colors.dark.background).toBe("oklch(0.18 0 0)")
    expect(resolved.colors.dark.foreground).toBe("oklch(0.96 0 0)")
    expect(resolved.colors.dark["card-foreground"]).toBe(resolved.colors.dark.foreground)
    expect(resolved.colors.dark.popover).toBe(resolved.colors.dark.card)
    expect(resolved.colors.dark["popover-foreground"]).toBe(resolved.colors.dark["card-foreground"])
    expect(resolved.colors.dark["sidebar-primary-foreground"]).toBe(resolved.colors.dark.card)
    expect(resolved.colors.dark["sidebar-foreground"]).toBe(resolved.colors.dark.foreground)
    expect(resolved.colors.dark["sidebar-border"]).toBe(resolved.colors.dark.border)
    expect(resolved.colors.dark.accent).toMatch(/^oklch\(/u)
    expect(resolved.geometry.radius).toBe(defaultThemeRadius)
  })

  test("publishes Effect validation through Standard Schema v1", () => {
    const valid = themeDefinitionSchema["~standard"].validate({
      colors: { light: { primary: "#006b66" } },
      geometry: {},
    })
    const invalid = themeDefinitionSchema["~standard"].validate({
      colors: { light: { primary: "not-a-color" } },
      geometry: {},
    })

    expect(valid).not.toBeInstanceOf(Promise)
    expect(invalid).not.toBeInstanceOf(Promise)
    expect("value" in valid).toBe(true)
    expect("issues" in invalid).toBe(true)
  })

  test("uses the default radius when geometry omits it", () => {
    const definition = createThemeDefinition()
    const resolved = resolveThemeDefinition({ ...definition, geometry: {} })

    expect(resolved.geometry.radius).toBe(defaultThemeRadius)
  })

  test("accepts only the schema URL, colors, and geometry at the top level", () => {
    const definition = createThemeDefinition()

    expect(resolveThemeDefinition({ $schema: themeDefinitionSchemaUrl, ...definition })).toEqual(
      resolveThemeDefinition(definition),
    )
    expect(() =>
      resolveThemeDefinition({ $schema: "https://example.com/theme.json", ...definition }),
    ).toThrow(/\$schema/u)
    expect(() => resolveThemeDefinition({ ...definition, metadata: "organization-seed" })).toThrow(
      /metadata/u,
    )
    expect(() => resolveThemeDefinition({ colors: definition.colors })).toThrow(/geometry/u)
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: { ...definition.colors.light, customization: { ring: "#008f88" } },
        },
      }),
    ).toThrow(/customization/u)
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: { ...definition.colors, dark: { primary: "#ffcc00", ring: "#ffcc00" } },
      }),
    ).toThrow(/ring/u)
  })

  test("preserves optional explicit dark values and derives every other dark role", () => {
    const derived = resolveThemeDefinition({
      colors: { light: { primary: "#006b66" } },
      geometry: {},
    })
    const resolved = resolveThemeDefinition({
      colors: {
        light: { primary: "#006b66" },
        dark: {
          background: "#101820",
          foreground: "#f3f8f7",
          primary: "#35d6b0",
          accent: "#7557d9",
        },
      },
      geometry: {},
    })

    expect(resolved.colors.dark.background).toBe("#101820")
    expect(resolved.colors.dark.foreground).toBe("#f3f8f7")
    expect(resolved.colors.dark.primary).toBe("#35d6b0")
    expect(resolved.colors.dark.accent).toBe("#7557d9")
    expect(Object.keys(resolved.colors.dark)).toEqual(themeTokenNames)
    expect(resolved.colors.dark["chart-1"]).toBe(resolved.colors.dark.primary)

    const darkBackground = resolveThemeDefinition({
      colors: { light: { primary: "#006b66" }, dark: { background: "#101820" } },
      geometry: {},
    })
    const darkForeground = resolveThemeDefinition({
      colors: { light: { primary: "#006b66" }, dark: { foreground: "#f3f8f7" } },
      geometry: {},
    })
    const darkPrimary = resolveThemeDefinition({
      colors: { light: { primary: "#006b66" }, dark: { primary: "#35d6b0" } },
      geometry: {},
    })
    const darkBackgroundDependents = [
      "card",
      "popover",
      "primary-foreground",
      "secondary",
      "muted",
      "accent",
      "border",
      "input",
      "sidebar",
      "sidebar-primary-foreground",
      "sidebar-accent",
      "sidebar-border",
    ] as const satisfies readonly ThemeToken[]
    const darkForegroundDependents = [
      "card-foreground",
      "popover-foreground",
      "secondary-foreground",
      "muted-foreground",
      "accent-foreground",
      "sidebar-foreground",
      "sidebar-accent-foreground",
    ] as const satisfies readonly ThemeToken[]

    expect(darkBackground.colors.dark.background).toBe("#101820")
    expect(
      darkBackgroundDependents.every(
        (token) => darkBackground.colors.dark[token] !== derived.colors.dark[token],
      ),
    ).toBe(true)
    expect(darkForeground.colors.dark.foreground).toBe("#f3f8f7")
    expect(
      darkForegroundDependents.every(
        (token) => darkForeground.colors.dark[token] !== derived.colors.dark[token],
      ),
    ).toBe(true)
    expect(darkPrimary.colors.dark.primary).toBe("#35d6b0")
    expect(darkPrimary.colors.dark["chart-1"]).toBe("#35d6b0")
    expect(darkPrimary.colors.dark["sidebar-primary"]).toBe("#35d6b0")
    expect(darkPrimary.colors.dark.ring).not.toBe(derived.colors.dark.ring)
    expect(darkPrimary.colors.dark["sidebar-ring"]).not.toBe(derived.colors.dark["sidebar-ring"])

    expect(() =>
      resolveThemeDefinition({
        colors: { light: { primary: "#006b66" }, dark: { background: "#ffffff" } },
        geometry: {},
      }),
    ).not.toThrow()
  })

  test("uses an optional light accent and derives its dark counterpart", () => {
    const definition = createThemeDefinition()
    const resolved = resolveThemeDefinition({
      ...definition,
      colors: {
        light: { ...definition.colors.light, accent: "#5b21b6" },
      },
    })

    expect(resolved.colors.light.accent).toBe("#5b21b6")
    expect(resolved.colors.light["sidebar-accent"]).toBe("#5b21b6")
    expect(resolved.colors.dark.accent).not.toBe(resolved.colors.dark.secondary)
    expect(resolved.colors.dark.accent).toMatch(/^oklch\(/u)
  })

  test("adapts derived surfaces for light colors near the contrast threshold", () => {
    const definition = createThemeDefinition()

    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: {
            ...definition.colors.light,
            foreground: "#767676",
          },
        },
      }),
    ).not.toThrow()
  })

  test("propagates direct source colors through dependent aliases", () => {
    const definition = createThemeDefinition()
    const resolved = resolveThemeDefinition({
      ...definition,
      colors: {
        light: {
          ...definition.colors.light,
          card: "#f5f5f5",
          border: "#cccccc",
          "primary-foreground": "#ffffff",
          ring: "#ff0000",
        },
      },
    })

    expect(resolved.colors.light.primary).toBe("#006b66")
    expect(resolved.colors.light.card).toBe("#f5f5f5")
    expect(resolved.colors.light.popover).toBe("#f5f5f5")
    expect(resolved.colors.light.border).toBe("#cccccc")
    expect(resolved.colors.light["sidebar-border"]).toBe("#cccccc")
    expect(resolved.colors.light["primary-foreground"]).toBe("#ffffff")
    expect(resolved.colors.light["sidebar-primary-foreground"]).toBe("#f5f5f5")
    expect(resolved.colors.light.ring).toBe("#ff0000")
    expect(resolved.colors.light["sidebar-ring"]).toBe("#ff0000")
    expect(resolved.colors.light.sidebar).toBe("#ffffff")
  })

  test("keeps the default card independent from a tinted page background", () => {
    const resolved = resolveThemeDefinition({
      colors: {
        light: {
          background: "#f3f8f7",
          foreground: "#111111",
          primary: "#006b66",
        },
      },
      geometry: {},
    })

    expect(resolved.colors.light.card).toBe("oklch(1 0 0)")
    expect(resolved.colors.light.popover).toBe(resolved.colors.light.card)
    expect(resolved.colors.light["sidebar-primary-foreground"]).toBe(resolved.colors.light.card)
    expect(resolved.colors.light.sidebar).toBe("#f3f8f7")
  })

  test("lets direct dependent colors win over propagated source roles", () => {
    const definition = createThemeDefinition()
    const resolved = resolveThemeDefinition({
      ...definition,
      colors: {
        light: {
          ...definition.colors.light,
          card: "#f5f5f5",
          popover: "#eeeeee",
          border: "#cccccc",
          "sidebar-border": "#bbbbbb",
          "primary-foreground": "#ffffff",
          "sidebar-primary-foreground": "#fefefe",
          ring: "#ff0000",
          "sidebar-ring": "#0000ff",
        },
      },
    })

    expect(resolved.colors.light.popover).toBe("#eeeeee")
    expect(resolved.colors.light["sidebar-border"]).toBe("#bbbbbb")
    expect(resolved.colors.light["sidebar-primary-foreground"]).toBe("#fefefe")
    expect(resolved.colors.light["sidebar-ring"]).toBe("#0000ff")
  })

  test("preserves explicit light-role provenance even when values equal defaults", () => {
    const base = {
      colors: {
        light: { primary: "#006b66" },
        dark: { background: "#101820", primary: "#35d6b0" },
      },
      geometry: {},
    }
    const omitted = resolveThemeDefinition(base)
    const explicitOklchCard = resolveThemeDefinition({
      ...base,
      colors: { ...base.colors, light: { ...base.colors.light, card: "oklch(1 0 0)" } },
    })
    const explicitHexCard = resolveThemeDefinition({
      ...base,
      colors: { ...base.colors, light: { ...base.colors.light, card: "#ffffff" } },
    })
    const explicitChartOne = resolveThemeDefinition({
      ...base,
      colors: { ...base.colors, light: { ...base.colors.light, "chart-1": "#006b66" } },
    })

    expect(explicitOklchCard.colors.dark.card).toBe(explicitHexCard.colors.dark.card)
    expect(explicitOklchCard.colors.dark.card).not.toBe(omitted.colors.dark.card)
    expect(explicitChartOne.colors.dark["chart-1"]).not.toBe(explicitChartOne.colors.dark.primary)
  })

  test("derives dark sidebar primary foreground from its light override", () => {
    const definition = createThemeDefinition()
    const baseline = resolveThemeDefinition(definition)
    const customized = resolveThemeDefinition({
      ...definition,
      colors: {
        light: {
          ...definition.colors.light,
          "sidebar-primary-foreground": "oklch(0.99 0.01 100)",
        },
      },
    })

    expect(customized.colors.light["sidebar-primary-foreground"]).toBe("oklch(0.99 0.01 100)")
    expect(customized.colors.dark["sidebar-primary-foreground"]).not.toBe(
      baseline.colors.dark["sidebar-primary-foreground"],
    )
  })

  test("keeps the exported token inventory immutable across compilations", () => {
    expect(Object.isFrozen(themeTokenNames)).toBe(true)

    const first = compileThemeCss({ colors: { light: { primary: "#006b66" } }, geometry: {} })

    expect(Reflect.deleteProperty(themeTokenNames, "0")).toBe(false)
    expect(compileThemeCss({ colors: { light: { primary: "#006b66" } }, geometry: {} })).toEqual(
      first,
    )
  })

  test("rejects invalid, transparent, and low-contrast authoring colors", () => {
    const definition = createThemeDefinition()

    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: { ...definition.colors.light, primary: "not-a-color" },
        },
      }),
    ).toThrow("Theme colors must be valid opaque CSS colors")
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: { light: { ...definition.colors.light, primary: " #006b66 " } },
      }),
    ).toThrow("Theme colors must not have surrounding whitespace")
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: { ...definition.colors.light, primary: `red${" ".repeat(254)}` },
        },
      }),
    ).toThrow(`Theme colors must be at most 256 characters`)
    for (const primary of ["oklch(none none none)", "oklch(0.5 none 120)", "oklch(0.5 0 none)"]) {
      expect(() =>
        resolveThemeDefinition({
          ...definition,
          colors: { light: { ...definition.colors.light, primary } },
        }),
      ).toThrow("Theme colors must be valid opaque CSS colors")
    }
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: { ...definition.colors.light, primary: "rgb(0 0 0 / 99.95%)" },
        },
      }),
    ).toThrow("Theme colors must be valid opaque CSS colors")
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: { ...definition.colors.light, foreground: "#aaaaaa" },
        },
      }),
    ).toThrow(/contrast/u)
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: {
            ...definition.colors.light,
            "primary-foreground": definition.colors.light.primary,
          },
        },
      }),
    ).toThrow(/contrast/u)
  })

  test("resolves and generates deterministic OKLCH output", () => {
    const definition = createThemeDefinition()
    const first = resolveThemeDefinition(definition)
    const second = resolveThemeDefinition(definition)

    expect(second).toEqual(first)
    expect(generateThemeCss(second)).toBe(generateThemeCss(first))
    expect(first.colors.light["chart-2"]).toMatch(/^oklch\(/u)
    expect(first.colors.dark["chart-2"]).toMatch(/^oklch\(/u)
  })

  test("derives accessible foregrounds even when neither authored endpoint works", () => {
    expect(() =>
      resolveThemeDefinition({
        colors: {
          light: {
            background: "#ffffff",
            foreground: "#767676",
            primary: "#aaaaaa",
            card: "#aaaaaa",
          },
        },
        geometry: {},
      }),
    ).not.toThrow()
  })

  test("derives readable status colors and rejects unsafe explicit status values", () => {
    const resolved = resolveThemeDefinition({
      colors: { light: { primary: "#006b66" } },
      geometry: {},
    })

    expect(resolved.colors.light.destructive).toMatch(/^oklch\(/u)
    expect(resolved.colors.light.warning).toMatch(/^oklch\(/u)
    expect(() =>
      resolveThemeDefinition({
        colors: {
          light: {
            primary: "#006b66",
            destructive: "#ffffff",
          },
        },
        geometry: {},
      }),
    ).toThrow(/contrast/u)
  })

  test("derives visible focus indicators and rejects unsafe explicit rings", () => {
    const resolved = resolveThemeDefinition({
      colors: {
        light: {
          background: "#ffffff",
          primary: "#ffffff",
        },
      },
      geometry: {},
    })

    expect(
      testContrastRatio(resolved.colors.light.background, resolved.colors.light.ring),
    ).toBeGreaterThanOrEqual(3.05)
    expect(() =>
      resolveThemeDefinition({
        colors: {
          light: {
            background: "#ffffff",
            primary: "#006b66",
            ring: "#ffffff",
          },
        },
        geometry: {},
      }),
    ).toThrow(/focus indicators/u)
  })

  test("derives chart one from primary and uses stable categorical chart defaults", () => {
    const chartDefaults = [
      "oklch(0.60557 0.107271 183.982408)",
      "oklch(0.398 0.07 227.392)",
      "oklch(0.8299 0.171283 81.314511)",
      "oklch(0.770892 0.1721 65.636832)",
    ]

    for (const primary of ["#777777", "#006b66"]) {
      const resolved = resolveThemeDefinition({
        colors: { light: { primary } },
        geometry: {},
      })

      expect(resolved.colors.light["chart-1"]).toBe(primary)
      expect([
        resolved.colors.light["chart-2"],
        resolved.colors.light["chart-3"],
        resolved.colors.light["chart-4"],
        resolved.colors.light["chart-5"],
      ]).toEqual(chartDefaults)
    }

    const resolved = resolveThemeDefinition({
      colors: { light: { primary: "#006b66" } },
      geometry: {},
    })

    expect([
      resolved.colors.dark["chart-2"],
      resolved.colors.dark["chart-3"],
      resolved.colors.dark["chart-4"],
      resolved.colors.dark["chart-5"],
    ]).toEqual([
      "oklch(0.722111 0.112634 183.982408)",
      "oklch(0.75796 0.0735 227.392)",
      "oklch(0.748486 0.156266 77.560619)",
      "oklch(0.791199 0.16896 69.469531)",
    ])
  })

  test("propagates direct chart overrides into their dark roles", () => {
    const baseline = resolveThemeDefinition({
      colors: { light: { primary: "#006b66" } },
      geometry: {},
    })

    for (const token of ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const) {
      const resolved = resolveThemeDefinition({
        colors: { light: { primary: "#006b66", [token]: "#ff0000" } },
        geometry: {},
      })

      expect(resolved.colors.light[token]).toBe("#ff0000")
      expect(resolved.colors.dark[token]).not.toBe(baseline.colors.dark[token])
    }

    const chartOne = resolveThemeDefinition({
      colors: { light: { primary: "#006b66", "chart-1": "#ff0000" } },
      geometry: {},
    })
    expect(chartOne.colors.dark["chart-1"]).not.toBe(chartOne.colors.dark.primary)
  })

  test("derives ring and chart one from explicit dark primary", () => {
    const resolved = resolveThemeDefinition({
      colors: {
        light: { primary: "#006b66" },
        dark: { primary: "#35d6b0" },
      },
      geometry: {},
    })
    const alternative = resolveThemeDefinition({
      colors: {
        light: { primary: "#006b66" },
        dark: { primary: "#60a5fa" },
      },
      geometry: {},
    })

    expect(resolved.colors.light["chart-1"]).toBe(resolved.colors.light.primary)
    expect(resolved.colors.dark["chart-1"]).toBe(resolved.colors.dark.primary)
    expect(
      testContrastRatio(resolved.colors.dark.background, resolved.colors.dark.ring),
    ).toBeGreaterThanOrEqual(3.05)
    expect(alternative.colors.dark.ring).not.toBe(resolved.colors.dark.ring)
    expect(alternative.colors.dark["chart-1"]).toBe(alternative.colors.dark.primary)
  })

  test("derives an accessible muted foreground when the root foreground cannot work", () => {
    const resolved = resolveThemeDefinition({
      colors: {
        light: {
          background: "#ffffff",
          foreground: "#111111",
          primary: "#006b66",
          muted: "#111111",
        },
      },
      geometry: {},
    })

    expect(resolved.colors.light.muted).toBe("#111111")
    expect(resolved.colors.light["muted-foreground"]).not.toBe("#111111")
  })

  test("keeps serialized derived OKLCH colors inside the raw sRGB gamut", () => {
    const definitions = [
      createThemeDefinition(),
      {
        colors: {
          light: {
            background: "#ffffff",
            foreground: "#111111",
            primary: "#0000ff",
          },
        },
        geometry: {},
      },
      {
        colors: {
          light: {
            background: "#ffffff",
            foreground: "#111111",
            primary: "oklch(2 0.2 20)",
          },
        },
        geometry: {},
      },
    ]

    for (const definition of definitions) {
      const resolved = resolveThemeDefinition(definition)

      for (const mode of ["light", "dark"] as const) {
        for (const token of themeTokenNames) {
          const colorValue = resolved.colors[mode][token]
          if (!colorValue.startsWith("oklch(")) continue
          if (mode === "light" && Object.values(definition.colors.light).includes(colorValue)) {
            continue
          }

          expect(isOklchInRawSrgbGamut(colorValue), `${mode}.${token}: ${colorValue}`).toBe(true)
        }
      }
    }
  })

  test("propagates optional light roles into their corresponding dark roles", () => {
    const definition = createThemeDefinition()
    const baseline = resolveThemeDefinition(definition)
    const customized = resolveThemeDefinition({
      ...definition,
      colors: { light: { ...definition.colors.light, ring: "#ff0000" } },
    })

    expect(customized.colors.light.ring).toBe("#ff0000")
    expect(customized.colors.dark.ring).not.toBe(baseline.colors.dark.ring)
    expect(customized.colors.dark["sidebar-ring"]).not.toBe(baseline.colors.dark["sidebar-ring"])
  })
})

function isOklchInRawSrgbGamut(colorValue: string): boolean {
  const component = parseComponentValue(tokenize({ css: colorValue }))
  if (!component) return false
  const parsed = color(component)
  if (parsed === false || parsed.colorNotation !== ColorNotation.OKLCH) return false

  const [lightness, chroma, hue] = parsed.channels
  const hueRadians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(hueRadians)
  const b = chroma * Math.sin(hueRadians)
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3
  const channels = [
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  ]

  const roundingTolerance = 0.000_001
  return channels.every(
    (channel) => channel >= -roundingTolerance && channel <= 1 + roundingTolerance,
  )
}

function testContrastRatio(first: string, second: string): number {
  const firstLuminance = testLuminance(first)
  const secondLuminance = testLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)

  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2))
}

function testLuminance(colorValue: string): number {
  const component = parseComponentValue(tokenize({ css: colorValue }))
  if (!component) throw new Error(`Unable to parse test color: ${colorValue}`)
  const parsed = color(component)
  if (parsed === false) throw new Error(`Unable to parse test color: ${colorValue}`)

  const serialized = serializeRGB(
    { ...parsed, channels: [...parsed.channels], syntaxFlags: new Set(parsed.syntaxFlags) },
    false,
  )
  const channels = serialized.value.flatMap((serializedComponent) => {
    if (!isTokenNode(serializedComponent) || !isTokenNumber(serializedComponent.value)) return []
    return [serializedComponent.value[4].value]
  })
  if (channels.length < 3) throw new Error(`Unable to convert test color: ${colorValue}`)

  const [red, green, blue] = channels
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Unable to convert test color: ${colorValue}`)
  }
  return (
    0.2126 * testLinearizeSrgb(red) +
    0.7152 * testLinearizeSrgb(green) +
    0.0722 * testLinearizeSrgb(blue)
  )
}

function testLinearizeSrgb(channel: number): number {
  const normalized = channel / 255
  return normalized <= 0.040_45 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}
