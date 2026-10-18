# Todos Rails example development

- Keep canonical Rails 8 with Propshaft, import maps, SQLite, Minitest, RuboCop, Brakeman, and bundler-audit. Use one plain ES module per page. Add no Hotwire, Node, npm, JavaScript bundler, or CSS framework. Validate with `bin/ci`.
- Load the SDK through the jsDelivr URL pinned in `config/importmap.rb`, never `bin/importmap pin`, whose vendoring drops lazy chunks. Use `ASTRALBEAM_SDK_URL` for local builds.
- Keep `lib/astral_beam.rb` a dependency-light, copy-pasteable token minter matching `createAstralBeamToken` and the authentication guide's wire format.
- Pages and tools mutate todos only through JSON actions and update the DOM in place so navigation cannot interrupt responses. Restore saved history by default in the same tab.
- Prefix page CSS variables with `--app-` and set them on `[slot]` containers so widget cards inherit them through the shadow tree.
- Match the demo identity in `AstralBeamTokensController` to `platform/scripts/seed/fixtures.ts`. Keep that action disabled in production.
