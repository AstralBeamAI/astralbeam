import { readFile } from "node:fs/promises"
import { describe, expect, test } from "vitest"

import { updateThemeStylesheet } from "./brand.ts"

describe("application brand theme", () => {
  test("keeps the generated styles.css section byte-identical to brand.json", async () => {
    const stylesheet = await readFile(new URL("../../src/styles.css", import.meta.url), "utf8")

    expect(updateThemeStylesheet(stylesheet)).toBe(stylesheet)
  })
})
