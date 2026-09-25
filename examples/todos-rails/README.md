# Todos Rails example

A Ruby on Rails 8 app that embeds the AstralBeam chat sidebar and tenant-user directory from a jsDelivr script, with no npm or JavaScript bundler. It mirrors [`examples/todos`](../todos): the agent manages todos through host tools, projects `todoCard` widgets into the conversation, and reads the tenant's users.

## How it fits together

| Piece | File |
| --- | --- |
| SDK loaded from jsDelivr through the import map | [`config/importmap.rb`](config/importmap.rb) |
| Todo list, chat mount, host tools, and the `todoCard` widget | [`app/javascript/todos.js`](app/javascript/todos.js) |
| Tenant-user directory mount | [`app/javascript/tenant_users.js`](app/javascript/tenant_users.js) |
| Token minting with the `jwt` gem | [`lib/astral_beam.rb`](lib/astral_beam.rb) |
| Token endpoint at `POST /astralbeam/token` | [`app/controllers/astral_beam_tokens_controller.rb`](app/controllers/astral_beam_tokens_controller.rb) |
| JSON API the page and tools call | [`app/controllers/todos_controller.rb`](app/controllers/todos_controller.rb) |

- The tools send Rails' CSRF token with every `fetch`, including the widget's token request.
- The app uses no Turbo or Stimulus. Each page is one plain ES module. After the page or a tool changes a todo, the module reloads the list from the JSON API and redraws it and any cards in place, so the chat transcript survives.
- To copy the token minter into your own app, add `gem "jwt"` and `lib/astral_beam.rb`, then derive `user` and `tenant` from your session instead of the demo identity.

## Run

You need the Ruby version in [`.ruby-version`](.ruby-version) and a running AstralBeam platform.

1. Seed the platform database with `deno task --cwd platform db-seed` from the repository root. It writes `.env` here with the seeded API key and agent ID when the file does not exist yet. To configure it by hand, copy `.env.example` to `.env` and fill it in from the dashboard.
2. Start the platform on port 4500 with `deno task --cwd platform dev`. Chat also needs the organization's OpenAI API key, which the seed copies from `platform/.env.local`.
3. From this directory, run `bin/setup`, which installs gems, creates and seeds the SQLite database, and starts the server on <http://localhost:3000>. Later, `bin/dev` starts it alone.

The pinned SDK version must already be published on npm. To try unreleased SDK changes, build the SDK with `deno task --cwd sdk build`, serve `sdk/dist` with `deno run -A jsr:@std/http/file-server --cors --port 4601 sdk/dist`, and start this app with `ASTRALBEAM_SDK_URL=http://localhost:4601/client.js bin/dev`.

## Try it

- Ask the assistant to add, complete, or delete todos, and watch the list update.
- Ask it to show a todo as a card, then toggle the card's checkbox and confirm the list follows.
- Toggle **Theme**, **Custom theme**, **Hide assistant**, and **Debug**. They update the widget in place, so the conversation stays put.
- Open **Tenant users** to browse the current tenant's users with the SDK directory, and enable **Show stored admin fields**.

The demo token endpoint hands a fixed identity to any caller and answers `503` in production. Before deploying, replace it with one that derives stable Tenant and tenant-local user IDs from your authenticated session. Follow the [SDK authentication guide](https://app.astralbeam.ai/docs/sdk/authentication).

## Checks

`bin/ci` runs RuboCop, bundler-audit, the import map audit, Brakeman, and the tests. CI runs the same command.
