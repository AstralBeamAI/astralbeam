# Theme development

- Keep the Theme module neutral: it owns the semantic theme contract and utilities, while Brand and application code own concrete theme values.
- Keep generic resolved color and palette conversion in this module; concrete modules may bind those functions to their own validated theme documents but must not duplicate the token-to-property adapter.
- Keep prerelease Effect versions pinned exactly so Schema APIs do not drift during routine installs.
- Keep the module pure and structurally typed: no filesystem, HTTP, DOM mutation, environment branching, mutable global caches, or request decoding. Concrete applications own those effects.
- Update the token list, strict Effect schemas, deterministic resolver, pure CSS utilities, documentation, and tests together whenever the semantic contract changes.
- Use `compileThemeCss` for an untrusted compact definition at an application boundary, `resolveThemeDefinition` when the resolved document is needed, and `parseThemeDocument` for already resolved runtime documents; downstream CSS utilities accept only the exhaustive resolved contract.
- Keep light authoring input flat within `colors.light`; restrict optional `colors.dark` authoring to `background`, `foreground`, `primary`, and `accent`; and reject metadata and nested customization wrappers. Permit only the canonical `$schema` URL alongside the required top-level `colors` and `geometry` keys.
- Treat checked-in `apps/webapp/src/theme/theme.schema.json` as the master authoring schema. Keep the schema `$id`, Brand `$schema`, runtime structure, and exported `themeDefinitionSchemaUrl` synchronized. The JSON Schema defines structure and editor metadata; runtime validation remains authoritative for CSS parsing, opacity, derivation, and contrast.
- Keep the exported Effect schemas Standard Schema v1-compatible for organization-admin form tooling.
- Preserve dependency-aware resolution: a direct source color must flow into derived aliases unless an alias-specific color is supplied.
- Treat changes to OKLCH derivation, WCAG contrast selection, status defaults, or dark-mode transforms as breaking authoring behavior because persisted definitions can otherwise resolve differently.
- Preserve deterministic token ordering so generated stylesheets are reproducible.
