import { writeFile } from "node:fs/promises"

import { generateThemeCss } from "@astralbeam/theme"

import { theme } from "@astralbeam/brand"

const outputUrl = new URL("../src/colors.css", import.meta.url)

await writeFile(outputUrl, generateThemeCss(theme), "utf8")

console.log("Wrote src/colors.css")
