import { writeFile } from "node:fs/promises"

import { generateThemeCss } from "../../src/theme/theme"

import { theme } from "../../src/brand"

const outputUrl = new URL("../../src/brand/colors.css", import.meta.url)

await writeFile(outputUrl, generateThemeCss(theme), "utf8")

console.log("Wrote src/colors.css")
