# Webapp end-to-end suite

Browser tests that drive the dashboard against a real server, a real PostgreSQL database, and real email. They exist so a change to authentication, `/configure`, or any organization page can be verified in a minute without anyone clicking through signup, verification, and organization creation by hand.

The suite is self-contained and deterministic. It creates and migrates its own database, starts its own webapp, and captures email in its own SMTP sink, so a default run touches neither the development database nor the 4500 development server, and never starts a container. The one project that does run containers is opt-in.

## Run it

```sh
deno task --cwd webapp e2e:install   # once, to fetch Chromium
deno task --cwd webapp e2e
```

- `deno task e2e -g "some title"` narrows to matching test titles while iterating. Playwright does not apply `-g` to a dependency project, so the baseline below is still established.
- `deno task e2e --project=features` runs only the focused specs, after their dependencies.
- `E2E_SANDBOX=docker deno task e2e` adds the `sandbox` project. Its specs save a sandbox provider, which runs the product's real connection test, so they create, use, and destroy a container and may pull `node:22` first. The project does not exist without that variable, so a run without it is deterministic rather than dependent on whether a daemon happens to be up.
- `deno task e2e --ui` opens Playwright's runner for stepping through a flow.
- It is not part of `check`, `test`, or `ready`, and it does not run in CI. Run it deliberately.

Every run drops and recreates the suite's database, so it is repeatable and leaves no state behind between runs. Nothing needs seeding first.

The `list` reporter narrates every `test.step` as it starts and finishes, with its duration, so the terminal shows what the run is doing rather than sitting silent until the journey's single long test ends.

## Evidence

Video, traces, and screenshots are kept for any failure and land in `e2e/.output`, which is git-ignored.

```sh
deno task --cwd webapp e2e:capture   # record video, trace, and screenshots for a passing run too
playwright show-report e2e/.output/report
playwright show-trace e2e/.output/test-results/<test>/trace.zip
```

Use `E2E_CAPTURE=all` when the run itself is the evidence for a pull request. `captureMilestone(page, name)` writes a named screenshot to the test's output directory and attaches it to the report, so `e2e/.output/test-results/<test>/01-configure-complete.png` is ready to attach to a pull request.

## Layout

| File                   | Owns                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `playwright.config.ts` | Projects, timeouts, capture settings, and the two servers                    |
| `worktree.ts`          | Paths, ports, the suite's database URL, and the environment each server gets |
| `prepare-database.ts`  | Drops, recreates, and migrates the suite's database before the server starts |
| `mailbox-server.ts`    | The SMTP sink and its read-only HTTP API                                     |
| `mailbox.ts`           | Reading captured email and pulling links out of it                           |
| `preflight.setup.ts`   | Fails once with an actionable message when the environment is not ready      |
| `baseline.ts`          | The configured deployment and signed-in owner the journey hands to features  |
| `fixtures.ts`          | The `test` a spec imports, with every page object attached as a fixture      |
| `identity.ts`          | Unique per-run names, emails, and slugs                                      |
| `hydration.ts`         | Waiting for React to attach before a click or a fill                         |
| `dialogs.ts`           | Locating a dialog without matching a toast                                   |
| `capture.ts`           | Attaching a named screenshot to the report                                   |
| `pages/`               | Selectors and actions, one module per surface                                |
| `specs/journey/`       | The full cold-start journey, which is also the suite's setup project         |
| `specs/features/`      | Focused specs, which start from the journey's baseline                       |
| `specs/sandbox/`       | Specs that run real containers, present only under `E2E_SANDBOX=docker`      |

## Projects, and the baseline between them

Three default Playwright projects run in a dependency chain, with a fourth opt-in sandbox project, so state a spec relies on is established by a project it depends on rather than by an unwritten ordering rule.

1. `preflight` checks the environment.
2. `journey` drives the product from an unconfigured deployment, and ends by writing `.output/baseline.json` and `.output/baseline-state.json`.
3. `features` depends on `journey`, so its specs open with the owner already signed in and read that organization from the `baseline` fixture.
4. `sandbox` depends on `journey` the same way, and exists only under `E2E_SANDBOX=docker`.

## Adding a flow

Compose it from the page objects; a spec should read as the user's steps and nothing else.

1. Add `specs/features/<feature>.spec.ts` and import `{ expect, test }` from `../../fixtures.ts`.
2. Take the page objects you need from the fixture argument. Add a method to a page object rather than putting a raw selector in a spec.
3. Take the organization to work in from the `baseline` fixture; the spec is already signed in as its owner. `test.use({ storageState: { cookies: [], origins: [] } })` gets a signed-out context instead, as `route-guards.spec.ts` does.
4. Take unique names from `makeRunIdentity()` for anything the spec creates, so two runs never collide.
5. Put a flow that needs an unconfigured deployment in `specs/journey` instead, and extend the baseline it records if a later spec needs more of it. Put anything that starts a container in `specs/sandbox`.

## How the environment is assembled

`worktree.ts` derives three ports from the worktree path, so a given worktree always uses the same ones and two worktrees can run at once. It also derives the suite's database from `DATABASE_URL` in `webapp/.env*` by appending `_e2e`, which `prepare-database.ts` refuses to touch unless the name really ends that way and the host is loopback.

The webapp server is given only `PORT`, `DATABASE_URL`, `APP_BASE_URL`, and the resolved `DOCKER_HOST`. Everything else, including the authentication secret and the SMTP port, is configured through `/configure` by the journey itself, which is what makes that page part of the test rather than a prerequisite. Turnstile keys come from the checked-in `webapp/.env.development`, whose Cloudflare test keys always pass.

`E2E_DATABASE_URL`, `E2E_WEBAPP_PORT`, `E2E_SMTP_PORT`, and `E2E_MAILBOX_PORT` override the derived values.

## When something changes, update this

| Change                                 | Update                                    |
| -------------------------------------- | ----------------------------------------- |
| A page's markup or control labels      | that surface's module in `pages/`         |
| Required configuration keys            | the configure step in `specs/`            |
| Server startup, ports, or required env | `worktree.ts`                             |
| A new capability to cover              | a new spec under `specs/features`         |
| A capability that needs a container    | a new spec under `specs/sandbox`          |
| What a focused spec may assume         | `baseline.ts` and the journey's last step |

## Things that will bite you

- **Every page is server-rendered, so a control is clickable before React attaches to it.** An early click is dropped, an early submit posts the form natively, and an early fill into a React-controlled input is discarded at hydration. `waitForHydration(locator)` from `hydration.ts` waits for React's own instance key on the element; use it after any `page.goto`, and not after an in-app navigation.
- **Base UI toasts carry `role="dialog"`.** `getByRole("dialog")` matches every toast still on screen, so use `openDialog(page)` and `openAlertDialog(page)` from `dialogs.ts`.
- **The shadcn checkbox keeps its `id` on a hidden proxy input.** `#some-checkbox` is never clickable; use `getByRole("checkbox")`.
- **`/configure` renders its action row above and below the fields**, so `Save`, `Sign out`, and `Go to app` each match twice.
- **A value supplied by the server's environment is read-only in `/configure`.** `isEnvironmentProvided(key)` says so, and the journey asserts it for the authentication secret rather than failing on a disabled input.
- **The invitations table keeps a cancelled row** and only changes its status badge, so a cancelled invitation does not disappear.
- **Creating an organization generates a random slug suffix**, so a spec that asserts URLs must type its own slug into the dialog.
- **Signing up checks the password against Have I Been Pwned**, which is a real network call. `makeRunIdentity()` returns a random password, which satisfies it.
- **Saving a sandbox provider runs a real connection test**, which is why that lives behind `E2E_SANDBOX=docker` rather than behind an ambient daemon probe. `worktree.ts` resolves the CLI's active context into `DOCKER_HOST` and forwards it to the server, so the spec's probe and the application cannot end up on different daemons.
- **A mutation's own controls are disabled while it runs and enabled again afterwards**, so waiting on a button says nothing about whether the write landed. Page-object methods wait for the success toast through `expectToast`, which is what makes them safe to compose.
