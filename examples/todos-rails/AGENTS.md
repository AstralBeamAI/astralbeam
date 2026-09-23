# Todos Rails example development

- Keep this a canonical Rails 8 app: Propshaft, import maps, Turbo, Stimulus, SQLite, Minitest, and the generator's RuboCop, Brakeman, and bundler-audit setup. Add no Node, npm, bundler, or CSS framework.
- Load the SDK only through the jsDelivr URL pinned in `config/importmap.rb`, never `bin/importmap pin`, because vendoring drops the loader's lazy chunks. `ASTRALBEAM_SDK_URL` overrides it for local SDK builds.
- Keep `lib/astral_beam.rb` a dependency-light, copy-pasteable token minter that matches `createAstralBeamToken` and the authentication guide's wire format.
- Agent tools call the app's own JSON actions, then morph-refresh the page. Keep widget mount points `data-turbo-permanent` with stable IDs, and keep page toggles in the query string so refreshes preserve them.
- Prefix page CSS custom properties with `--app-` and set them on `[slot]` containers too, because widget cards inherit through the widget's shadow tree.
- Keep the demo identity in `AstralBeamTokensController` matched to `webapp/scripts/seed/fixtures.ts`, and keep that action disabled in production.
- Validate with `bin/ci`, which CI runs.
