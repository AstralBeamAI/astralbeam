import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { describe, expect, test } from "vitest"

import { palette, theme } from "./brand.ts"
import { generateThemeCss, resolveThemePalette, type ThemeMode } from "./theme.ts"

const themeModes = ["light", "dark"] as const satisfies readonly ThemeMode[]

describe("application brand theme", () => {
  test("validates and exhaustively resolves the source document", () => {
    expect(theme.geometry).toEqual({ radius: "0.45rem" })
    expect(Object.keys(theme.colors.light)).toHaveLength(32)
    expect(Object.keys(theme.colors.dark)).toEqual(Object.keys(theme.colors.light))
    expect(Object.isFrozen(theme)).toBe(true)
    expect(Object.isFrozen(theme.colors)).toBe(true)
    expect(Object.isFrozen(theme.colors.light)).toBe(true)
    expect(Object.isFrozen(theme.colors.dark)).toBe(true)
    expect(Object.isFrozen(theme.geometry)).toBe(true)
  })

  test("generates the materialized CSS exactly", async () => {
    const stylesheet = await readFile(new URL("../styles.css", import.meta.url), "utf8")
    const startMarker = "/* Generated theme variables: start */\n"
    const endMarker = "/* Generated theme variables: end */"
    const startIndex = stylesheet.indexOf(startMarker)
    const endIndex = stylesheet.indexOf(endMarker, startIndex + startMarker.length)

    expect(startIndex).toBeGreaterThanOrEqual(0)
    expect(endIndex).toBeGreaterThan(startIndex)
    expect(generateThemeCss(theme)).toBe(
      stylesheet.slice(startIndex + startMarker.length, endIndex),
    )
  })

  test("materializes the generic resolved palette for both modes", () => {
    for (const mode of themeModes) {
      expect(palette[mode]).toEqual(resolveThemePalette(theme, mode))
    }
  })

  test("keeps the brand theme and palette browser-safe", () => {
    const brandModuleUrl = new URL("./brand.ts", import.meta.url).href
    const browserImport = spawnSync(
      process.execPath,
      [
        "eval",
        "--conditions=browser",
        `const brand = await import(${
          JSON.stringify(brandModuleUrl)
        }); if (!brand.theme || !brand.palette) Deno.exit(1)`,
      ],
      { cwd: new URL(".", import.meta.url) },
    )

    expect({ status: browserImport.status }).toEqual({ status: 0 })
  })
})
