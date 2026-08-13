# `@astralbeam/theme`

`@astralbeam/theme` defines the neutral semantic theme contract shared by AstralBeam and tenant-provided color systems. UI components consume the resulting CSS custom properties and do not own theme selection or persistence.

## Theme documents

A `ThemeDocument` has exactly `colors` and `geometry` at the top level. `colors.light` and `colors.dark` are exhaustive maps containing all 32 semantic color tokens, while `geometry.radius` is a validated nonnegative CSS length. Unknown or missing keys, malformed dimensions, invalid CSS colors, colors with transparency, and semantic foreground pairs below 4.5:1 contrast are rejected.

Theme documents are deliberately resolved rather than abbreviated. Equal values in one preset do not make roles such as cards, popovers, charts, focus rings, and sidebars permanently identical, so every downstream CSS variable remains independently overrideable and reviewable.

```ts
import { parseThemeDocument } from "@astralbeam/theme"

const theme = parseThemeDocument(JSON.parse(themeJson))
```

## Theme utilities

Use an explicit mode to resolve one color, materialize an ergonomic sRGB palette, serialize a complete stylesheet, or create a CSS-variable value record.

```ts
import { generateThemeCss, resolveThemePalette, themeCssVariables } from "@astralbeam/theme"

const variables = themeCssVariables(theme, "light")
const palette = resolveThemePalette(theme, "light")
const primaryHex = palette.primary.srgbHex
const stylesheet = generateThemeCss(theme)
```

`resolveThemePalette` converts every semantic color to its CSS value, sRGB tuple, and hex value under stable camel-case properties such as `cardForeground` and `chart1`. It accepts an already validated exhaustive document and returns a fresh frozen value without mutating the document. `themeCssVariables` includes `--radius` and every semantic `--*` color property. `generateThemeCss` emits deterministic `.light` and `.dark` rules from the same document.

## Tenant authoring

A `ThemeDefinition` is the compact tenant-authoring input. It requires `colors` and `geometry` and may include the published `$schema` URL for editor assistance. `colors.light.primary` is the sole required color; light `background`, `foreground`, and every other semantic token are optional direct properties. An optional `colors.dark` object accepts only `background`, `foreground`, `primary`, and `accent`; all other dark roles remain derived. The resolver uses shadcn's neutral light background and foreground when they are omitted. An omitted `geometry.radius` resolves to shadcn's `0.625rem` default.

```ts
import { resolveThemeDefinition } from "@astralbeam/theme"

const theme = resolveThemeDefinition({
  colors: {
    light: {
      background: "#ffffff",
      foreground: "#111111",
      primary: "#006b66",
      accent: "#e9e6ff",
    },
    dark: {
      background: "#101820",
      foreground: "#f3f8f7",
      primary: "#35d6b0",
      accent: "#443c78",
    },
  },
  geometry: { radius: "0.5rem" },
})
```

The dark color map is derived deterministically in OKLCH from the resolved light definition and optional dark values. In light mode, `card` defaults to a neutral white surface, `popover` follows `card`, and `sidebar-primary-foreground` prefers that card surface when it remains accessible. The focus ring and first chart color derive from `primary`, while chart colors two through five use stable sRGB-gamut-mapped shadcn categorical defaults; every light role remains directly overrideable.

Each optional light role and dark role has an ordered derivation function that reads the theme resolved so far. A supplied source role flows into dependent aliases and dark roles, while an alias-specific value takes precedence. Derived colors are gamut-mapped and contrast-corrected before the complete `ThemeDocument` is validated.

Runtime validation uses Effect Schema, and the exported schemas implement Standard Schema v1 for form-library interoperability. Unknown keys are rejected recursively, omitted optional fields remain absent, colors must be opaque CSS values, and resolved semantic text pairs must meet at least 4.5:1 contrast. Derived focus-ring colors target at least 3:1 contrast against their surfaces.

For an endpoint or preview tool, pass already decoded untrusted data to the pure compiler. It returns plain serializable issues for expected validation failures and never reads requests, writes files, mutates browser state, or caches inputs.

```ts
import { compileThemeCss } from "@astralbeam/theme"

const result = compileThemeCss(untrustedThemeDefinition)

if (!result.ok) {
  console.log(result.issues)
} else {
  console.log(result.css)
}
```

JSON decoding, request-size limits, status codes, response headers, rate limiting, and cache policy belong to the consuming application. `generateThemeCss` remains the runtime-validated serializer for an exhaustive `ThemeDocument`, while `compileThemeCss` accepts a compact definition and performs resolution plus serialization in one deterministic step.

Keep the compact definition separate from the resolved runtime contract. Persist the resolved document when values must remain stable across resolver changes; derivation formulas are an authoring convenience and are not evaluated by UI components.

The checked-in authoring schema at `public/schemas/theme.schema.json`, also exported as `@astralbeam/theme/theme.schema.json`, defines token inventory, documented defaults, length limits, radius syntax, and editor tooling. WWW publishes the same bytes at `https://www.astralbeam.ai/schemas/theme.schema.json`. Theme definition files may reference that URL through `$schema`; resolved `ThemeDocument` values contain only `colors` and `geometry`. Effect Schema remains authoritative for CSS color parsing, opacity, derivation, and semantic contrast.
