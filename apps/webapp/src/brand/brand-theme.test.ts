import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { palette, theme } from "@astralbeam/brand"
import { generateThemeCss, resolveThemePalette, type ThemeMode } from "@astralbeam/theme"
import { describe, expect, test } from "vite-plus/test"

const themeModes = ["light", "dark"] as const satisfies readonly ThemeMode[]

describe("AstralBeam brand theme", () => {
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
    const stylesheet = await readFile(new URL("./colors.css", import.meta.url), "utf8")

    expect(generateThemeCss(theme)).toBe(stylesheet)
  })

  test("materializes the generic resolved palette for both modes", () => {
    for (const mode of themeModes) {
      expect(palette[mode]).toEqual(resolveThemePalette(theme, mode))
    }
  })

  test("keeps the brand theme and palette browser-safe", () => {
    const browserImport = spawnSync(
      process.execPath,
      [
        "--conditions=browser",
        "--input-type=module",
        "--eval",
        'const brand = await import("@astralbeam/brand"); if (!brand.theme || !brand.palette) process.exit(1)',
      ],
      {
        encoding: "utf8",
        cwd: new URL(".", import.meta.url),
      },
    )

    expect({ status: browserImport.status }).toEqual({ status: 0 })
  })
})
