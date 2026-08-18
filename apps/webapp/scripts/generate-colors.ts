import { writeFile } from "node:fs/promises"

import { theme } from "../src/brand/brand-theme.ts"
import { generateThemeCss } from "../src/theme/theme.ts"

const outputUrl = new URL("../src/brand/colors.css", import.meta.url)

await writeFile(outputUrl, generateThemeCss(theme), "utf8")

console.log("Wrote src/brand/colors.css")
