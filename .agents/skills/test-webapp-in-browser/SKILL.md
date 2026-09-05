---
name: test-webapp-in-browser
description: Test AstralBeam webapp flows in a browser, including /configure, password authentication, Mailpit email capture, and API-key UI. Use for AstralBeam browser verification or debugging.
---

# Test AstralBeam in a Browser

1. Read the applicable `AGENTS.md` or other `*md` files. Identify the configured execution environment (macOS or devcontainer) and follow its instructions.
2. Inspect existing webapp processes and service endpoints before starting anything. Do not replace another worktree's server. When using another port, make the browser origin and `APP_BASE_URL` match so auth cookies and email links target the tested instance.
3. Resolve AstralBeam's effective email configuration before an email test. A Mailpit run must use `EMAIL_PROVIDER=smtp`. Use the current environment's SMTP and Mailpit endpoints, whose repository defaults are `127.0.0.1:1025` and `127.0.0.1:8025`.
4. Reset only the current worktree's explicitly authorized, confirmed-disposable database using `webapp/src/db/README.md`. Use unique test identities when state changes unexpectedly. Do not clear the shared Mailpit inbox.
5. Prefer `deno task --cwd webapp db-seed` over bootstrapping by hand. It creates verified accounts, organizations, agents, API keys, and a sandbox provider in the worktree's own database, and prints every credential, so most flows can start already signed in. Its identities live in `webapp/scripts/seed/fixtures.ts`. Bootstrap through the UI only when the flow under test is itself signup, verification, invitation, or `/configure`.
6. Bootstrap through AstralBeam's UI as required: `/configure`, enter the database encryption key from `webapp/.env.development`, signup using password, verify the email using Mailpit, sign-in, and create Organization. Direct API calls and inserted rows are diagnostic aids, not final browser proof.
7. Invoking this skill authorizes the standard disposable localhost test workflow: enter the local `DATABASE_ENCRYPTION_KEY`, create or use disposable password accounts, verify them through Mailpit, and create disposable local API keys or other records required by the requested flow. Do not ask a separate permission question for these actions or pause to restate them.
8. For a Mailpit browser test `127.0.0.1:8025`, open its UI, filter to a unique current-run recipient, open the fresh message, and use its visible action link. Verify recipient, sender, subject, content, and that action links use the tested `APP_BASE_URL`.
9. Keep taking screenshots of screens relevant to current test and present the gif of all validated scenarios as proof.
