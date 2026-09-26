# Linearity

Linearity is a project-tracking playground built with TanStack Start, React, and shadcn/ui. It gives potential customers somewhere useful to try AstralBeam: ask Astro to triage issues, prepare a launch, or move work through a cycle, then watch the app change.

Acme and Orbit have separate projects, issues, and teams. You can create, edit, assign, filter, and delete issues, switch between lists and boards, browse projects and cycles, and inspect the activity feed. Astro reads and updates the same state through the SDK's tools and renders live issue cards in its replies.

## Run locally

1. From the repository root, build the SDK and install this example's frozen dependencies:

   ```sh
   deno task --cwd sdk build
   cd examples/linearity-react
   deno install --frozen
   cp .env.example .env.local
   ```

2. Set `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` in `.env.local`. Choose your own values. The app returns `503` until both are configured.
3. In the AstralBeam dashboard, create an Organization or use an existing one. Set its OpenAI API key under **Settings**, create an organization API key, and put the one-time value in `ASTRALBEAM_API_KEY` in `.env.local`.
4. Create an agent named **Astro**, paste the prompt below into its system prompt, and copy its public ID to `VITE_ASTRALBEAM_AGENT_ID`. The agent and API key must belong to the same Organization. Leaving the ID empty uses that Organization's default agent.
5. Keep `VITE_ASTRALBEAM_API_URL=https://app.astralbeam.ai/api` for AstralBeam Cloud. For a local platform, use its full `/api` base, such as `http://localhost:4500/api`. The key must come from that same platform.
6. From `examples/linearity-react`, start the app:

   ```sh
   deno task dev
   ```

7. Open [localhost:4800](http://localhost:4800), enter your Basic Auth credentials, and try a prompt in Astro. You can use the rest of the app without configuring AstralBeam, but the assistant will show a connection error until its credentials are ready.

For repository development, [`scripts/setup.sh`](../../scripts/setup.sh) builds the SDK and seeds the local platform. Its todos API key also works here, but choose the starter agent or create Astro rather than using the todos-specific agent. Worktrees get their own database through the existing setup scripts. Linearity itself needs no database.

### Astro's system prompt

```text
You are Astro, the assistant inside Linearity, a project-tracking app. Help the user turn plans into clear, manageable work. Be concise and specific.

Use inspect_workspace to learn the active workspace, its projects, and its members. Use list_issues to read current issues before discussing or changing them. Never invent IDs. Make changes only through create_issue and update_issue, and report success only after the tool succeeds. Omit fields that should stay unchanged. Use null only to remove an assignee.

Show created or updated issues with the issueCard widget, using each issue's opaque UUID. The cards stay connected to the app. Summarize large sets instead of repeating every issue. Ask a short question when a request is ambiguous. You can only act in the currently selected workspace.
```

The assistant's name and empty-state copy belong to the host UI. Its behavior belongs to the agent's dashboard configuration. Setting `title="Astro"` does not change the system prompt.

## Try it

- Ask, “Which high-priority issues are still open this cycle?”
- Ask, “Assign the SSO issue to Maya, make it urgent, and show me the issue.”
- Ask, “Create three enterprise launch tasks in Enterprise readiness and assign them to the right people.”
- Open an issue card in chat, change its status, and save. The list and the card update together.
- Switch to Orbit. The sample data and Astro's conversation change with the workspace.
- Refresh to check your edits, then choose **Reset demo** to restore both workspaces.

## What is saved

All project data and edits live in this browser's `linearity-demo:v1` localStorage entry. There is no application database, account signup, or real membership system. Different browsers start independently. Tabs on the same origin share saved data. Concurrent edits use the last saved snapshot.

Reset restores both workspaces, clears their local activity, and starts a fresh Astro conversation. It preserves the visitor ID, so repeated resets do not create new AstralBeam identities. Conversations themselves are held in memory and are lost on refresh. Reset does not erase records already synchronized to AstralBeam.

Astro sends chat messages, attachments, and tool results to the configured AstralBeam deployment. That service synchronizes Tenant and TenantUser identities and uses the Organization's model provider. The issue dataset stays local except for the data included in those requests.

The token route accepts only the two known demo workspaces and a valid visitor UUID. It combines them into a visitor-specific Tenant ID and never grants admin authority. Everyone with the playground password can select either workspace. A real customer app must derive the tenant and user from its own authenticated session, as described in [SDK authentication](https://app.astralbeam.ai/docs/sdk/authentication).

## Deploy to play.astralbeam.ai

Linearity needs a server for Basic Auth and token minting. Build it from the repository checkout, with Deno available and the SDK built first. A static-site host cannot run the token route.

| Variable | Read when | Purpose |
| --- | --- | --- |
| `BASIC_AUTH_USERNAME` | Server start | Playground username. Must not contain a colon. |
| `BASIC_AUTH_PASSWORD` | Server start | Playground password. Keep it in the deployment's secret store. |
| `ASTRALBEAM_API_KEY` | Server start | Confidential organization key from the selected AstralBeam deployment. |
| `APP_ORIGIN` | Server start | Set to `https://play.astralbeam.ai` behind a TLS proxy, without a trailing slash. Used for token-request origin checks. |
| `VITE_ASTRALBEAM_API_URL` | Build | Public API base, normally `https://app.astralbeam.ai/api`. |
| `VITE_ASTRALBEAM_AGENT_ID` | Build | Public ID of Astro. Optional when Astro is the default agent. |
| `PORT` | Server start | HTTP listener port. Defaults to `3000` in production and `4800` in development. |

From the repository root, install and build the application:

```sh
cd sdk
deno install --frozen
deno task build
cd ..
cd examples/linearity-react
deno install --frozen
deno task build
```

From `examples/linearity-react`, start the generated Deno server with the server variables supplied by your host:

```sh
deno task start
```

`start` optionally reads `.env.local`, and existing environment variables take precedence. Set `APP_ORIGIN` to the public HTTPS origin and terminate TLS at your hosting provider or reverse proxy. Keep the `Authorization` header intact. Point health checks at `/` with Basic Auth, or treat its unauthenticated `401` as a healthy response. Missing credentials produce `503`. HTML and token responses are never cached. Static JS, CSS, and the favicon contain public sample data and can be served by the host's asset layer.

## Checks and recording

From `examples/linearity-react`, run the project gate once before publishing:

```sh
deno task ready
```

The deterministic browser suite starts its own server on port 4818 and requires no model key:

```sh
deno task e2e
```

To record the real assistant against an already running, configured local demo, use:

```sh
E2E_BASE_URL=http://127.0.0.1:4800 E2E_LIVE_ASTRO=true E2E_CAPTURE=true E2E_OUTPUT_DIR=/tmp/linearity-recording deno task e2e walkthrough.spec.ts
```

The walkthrough records at 140% zoom so issue details and Astro’s replies remain readable in the README GIF. The browser suite uses disposable local credentials `local-review` / `linearity-local-only`. Set those only on the local demo used for recording. Never reuse them on the deployed playground. Chromium must already be installed, or install it with `deno task e2e:install`. Recordings and screenshots go to the system temporary directory by default, or to `E2E_OUTPUT_DIR`. Keep that path outside the repository.
