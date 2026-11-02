import { brandTheme, updateThemeStylesheet } from "./theme/brand.ts"
import { resolveThemePalette } from "./theme/theme.ts"

// The light roles src/emails/email-theme.ts inlines as static sRGB hex for email clients.
const emailPaletteProperties = [
  "background",
  "border",
  "card",
  "foreground",
  "muted",
  "mutedForeground",
  "primary",
  "primaryForeground",
] as const

const stylesheetUrl = new URL("../src/styles.css", import.meta.url)
const stylesheet = await Bun.file(stylesheetUrl).text()
const updated = updateThemeStylesheet(stylesheet)

if (updated !== stylesheet) await Bun.write(stylesheetUrl, updated)
console.log(`${updated === stylesheet ? "Unchanged" : "Wrote"} src/styles.css`)

const palette = resolveThemePalette(brandTheme, "light")
console.log(`Email theme tokens: radius ${brandTheme.geometry.radius}`)
for (const property of emailPaletteProperties) {
  console.log(`  ${property}: ${palette[property].srgbHex}`)
}
