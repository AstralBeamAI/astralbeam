# Todos Rails example development

- Keep this a canonical Rails 8 app without Hotwire: Propshaft, import maps, SQLite, Minitest, and the generator's RuboCop, Brakeman, and bundler-audit setup. Page behavior is one plain ES module per page. Add no Turbo, Stimulus, Node, npm, bundler, or CSS framework.
- Load the SDK only through the jsDelivr URL pinned in `config/importmap.rb`, never `bin/importmap pin`, because vendoring drops the loader's lazy chunks. `ASTRALBEAM_SDK_URL` overrides it for local SDK builds.
- Keep `lib/astral_beam.rb` a dependency-light, copy-pasteable token minter that matches `createAstralBeamToken` and the authentication guide's wire format.
- The page and the agent's tools change todos only through the app's JSON actions and update the DOM in place, because a full page load would discard the chat transcript.
- Prefix page CSS custom properties with `--app-` and set them on `[slot]` containers too, because widget cards inherit through the widget's shadow tree.
- Keep the demo identity in `AstralBeamTokensController` matched to `webapp/scripts/seed/fixtures.ts`, and keep that action disabled in production.
- Validate with `bin/ci`, which CI runs.
