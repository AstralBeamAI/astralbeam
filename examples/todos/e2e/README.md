# Todos end-to-end suite

Browser tests that drive this example against a real webapp, a real organization API key, and a real agent. They exist so a change to the SDK, the chat endpoint, or the dashboard can be verified in minutes without anyone clicking through `/configure`, signup, and API-key creation by hand.

The suite reads its identities from `webapp/scripts/seed/fixtures.ts`, the same file `deno task db-seed` writes, so there is nothing to copy between the two.

## Run it

```sh
deno task --cwd webapp db-reset          # optional: start from an empty database
deno task --cwd webapp db migrate
deno task --cwd webapp db-seed
deno task --cwd sdk build                # the example consumes sdk/dist
deno task --cwd examples/todos e2e:install
deno task --cwd examples/todos e2e
```

- `deno task e2e --project=app` runs only the free specs. Nothing in that project calls a model.
- `deno task e2e --project=agent` runs the specs that drive a real agent. **These spend OpenAI credits on every run.**
- The `agent` project disappears entirely when no `OPENAI_API_KEY` is configured, so a run without a key is green rather than misleading.
- `deno task e2e -g "some title"` narrows to matching test titles while iterating.

The suite starts its own webapp and todos servers on ports derived from the worktree path, so it never touches the 4500 and 4700 development servers and two worktrees can run at once. Set `E2E_WEBAPP_URL` and `E2E_TODOS_URL` to test servers you are already running instead.

## Evidence

Video, traces, and screenshots are kept for any failure and land in `e2e/.output`, which is git-ignored.

```sh
E2E_CAPTURE=all deno task e2e      # record video, trace, and screenshots for passing specs too
playwright show-report e2e/.output/report
playwright show-trace e2e/.output/test-results/<test>/trace.zip
```

Use `E2E_CAPTURE=all` when the run itself is the evidence for a pull request. `captureMoment(page, name)` from `capture.ts` attaches a labelled screenshot to the report, for a moment worth showing on its own.

## Layout

| File                   | Owns                                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| `playwright.config.ts` | Projects, retries, capture settings, and the two dev servers               |
| `worktree.ts`          | Project paths, ports, and the environment each server is given             |
| `preflight.setup.ts`   | Fails once with an actionable message when the database is not seeded      |
| `fixtures.ts`          | The `test` a spec imports, with `todos` and `chat` open and hydrated       |
| `pages/todos-page.ts`  | Selectors and actions for the host app's own UI                            |
| `pages/chat-widget.ts` | Selectors and actions for the embedded widget, including shadow-root notes |
| `tokens.ts`            | Signs chat tokens directly, for keys the app's token route will never mint |
| `capture.ts`           | Attaches a labelled screenshot to the report                               |
| `specs/app/`           | Deterministic specs; never call a model                                    |
| `specs/agent/`         | Specs that drive a real agent run                                          |

## Adding a flow

Compose it from the page objects; a spec should read as the user's steps and nothing else.

1. Decide the project. Does it need a model reply? `specs/agent/`. Otherwise `specs/app/`.
2. Add `specs/<project>/<feature>.spec.ts` and import `{ expect, test }` from `../../fixtures.ts`.
3. Take what you need from the `todos` and `chat` fixtures. Add a method to a page object rather than putting a raw selector in a spec.
4. Assert on side effects: the host's todo list, a tool row, the sandbox panel. Never assert on the assistant's wording, which changes between runs.

## When something changes, update this

| Change                                    | Update                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| SDK widget markup or accessible names     | `pages/chat-widget.ts`                                   |
| Host app UI or control labels             | `pages/todos-page.ts`                                    |
| Seeded accounts, keys, agents, or tenants | `webapp/scripts/seed/fixtures.ts`                        |
| Chat token claims or signing              | `tokens.ts`, kept in step with `sdk/src/server/index.ts` |
| Server startup, ports, or required env    | `worktree.ts`                                            |
| A new capability to cover                 | a new spec under `specs/app` or `specs/agent`            |

## Things that will bite you

- **The widget lives in an open shadow root.** Locators reach into it, but `body.innerText` does not. Assert through locators.
- **`getByLabel("Message")` is ambiguous** once a transcript exists, because the messages region matches too. Use `getByRole("textbox", { name: "Message" })`.
- **The page is server-rendered, so a click can land before React hydrates** and be silently dropped. `todosPage.open()` waits for hydration; keep new entry points going through it.
- **Every idle signal is an absence**, so a check that runs a moment too early passes against a run that never started. `chat.sendAndWait` waits for a new assistant turn first, which is why specs should use it rather than `send` plus `waitForIdle`.
- **Do not wait on `role="status"` generally.** The sandbox status pill uses it and stays as long as the conversation has a sandbox.
- **The widget renders a sandbox file write from the tool call, not its result**, so a row and a download appear even when the sandbox never started. Assert on `Wrote` versus `Could not write`, and on a command's `exit 0`.
- **`/api/chat` allows 20 requests a minute per tenant user**, and one agent turn spans several of them because each host-tool call ends a request and starts another. The example mints one fixed tenant user, so a full agent run can exhaust the window. `chat.sendAndWait` waits the window out and presses Retry rather than failing.
- **Keep `vite` out of this folder's import graph.** Playwright loads the config in its own process, where importing `vite` pulls in rolldown's native binding and fails to resolve under Deno.
- **`@astralbeam/sdk` cannot be imported here.** It reaches the example through a `file:` dependency, which Deno refuses to import as an npm package unless the whole project switches to a manual `node_modules` directory. That is why `tokens.ts` signs tokens itself.
