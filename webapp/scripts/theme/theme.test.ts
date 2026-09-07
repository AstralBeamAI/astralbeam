import { color, ColorNotation, serializeRGB } from "@csstools/css-color-parser"
import { isTokenNode, parseComponentValue } from "@csstools/css-parser-algorithms"
import { isTokenNumber, tokenize } from "@csstools/css-tokenizer"
import { Exit, Schema } from "effect"
import { describe, expect, test } from "vitest"

import {
  compileThemeCss,
  defaultThemeRadius,
  generateThemeCss,
  parseThemeDocument,
  resolveThemeDefinition,
  type ThemeDefinition,
  themeDefinitionSchemaUrl,
  type ThemeDocument,
  themeDocumentSchema,
  themeTokenNames,
} from "./theme.ts"

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
  test("requires the exact resolved structure and semantic token set", () => {
    const organizationTheme = createOrganizationTheme()
    const missingToken = { ...organizationTheme.colors.light } as Record<string, string>
    delete missingToken.background

    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: { ...organizationTheme.colors, light: missingToken },
      })
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
      })
    ).toThrow(/organization-only/u)
  })

  test("rejects unsafe radius values", () => {
    const organizationTheme = createOrganizationTheme()

    expect(() =>
      parseThemeDocument({ ...organizationTheme, geometry: { radius: "calc(1rem + 1px)" } })
    ).toThrow("Theme radius must be zero or a nonnegative px, rem, em, or percentage length")
    expect(() =>
      parseThemeDocument({ ...organizationTheme, geometry: { radius: "1rem; color: red" } })
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
      })
    ).toThrow("Theme colors must be valid opaque CSS colors")
    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          dark: { ...organizationTheme.colors.dark, primary: "rgb(0 0 0 / 50%)" },
        },
      })
    ).toThrow("Theme colors must be valid opaque CSS colors")
    expect(() =>
      parseThemeDocument({
        ...organizationTheme,
        colors: {
          ...organizationTheme.colors,
          dark: { ...organizationTheme.colors.dark, primary: "rgb(0 0 0 / 99.95%)" },
        },
      })
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
      })
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
        })
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
      })
    ).toThrow(/focus indicators/u)
  })
})

describe("theme CSS generation", () => {
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
      })
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
      resolveThemeDefinition({ $schema: "https://example.com/theme.json", ...definition })
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
      })
    ).toThrow(/customization/u)
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: { ...definition.colors, dark: { primary: "#ffcc00", ring: "#ffcc00" } },
      })
    ).toThrow(/ring/u)
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

  test("rejects invalid, transparent, and low-contrast authoring colors", () => {
    const definition = createThemeDefinition()

    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: { ...definition.colors.light, primary: "not-a-color" },
        },
      })
    ).toThrow("Theme colors must be valid opaque CSS colors")
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: { light: { ...definition.colors.light, primary: " #006b66 " } },
      })
    ).toThrow("Theme colors must not have surrounding whitespace")
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: { ...definition.colors.light, primary: `red${" ".repeat(254)}` },
        },
      })
    ).toThrow(`Theme colors must be at most 256 characters`)
    for (const primary of ["oklch(none none none)", "oklch(0.5 none 120)", "oklch(0.5 0 none)"]) {
      expect(() =>
        resolveThemeDefinition({
          ...definition,
          colors: { light: { ...definition.colors.light, primary } },
        })
      ).toThrow("Theme colors must be valid opaque CSS colors")
    }
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: { ...definition.colors.light, primary: "rgb(0 0 0 / 99.95%)" },
        },
      })
    ).toThrow("Theme colors must be valid opaque CSS colors")
    expect(() =>
      resolveThemeDefinition({
        ...definition,
        colors: {
          light: { ...definition.colors.light, foreground: "#aaaaaa" },
        },
      })
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
      })
    ).toThrow(/contrast/u)
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
      })
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
      })
    ).toThrow(/focus indicators/u)
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
