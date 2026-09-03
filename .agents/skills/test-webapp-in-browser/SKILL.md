---
name: test-webapp-in-browser
description: Test AstralBeam webapp flows in a browser, including /configure, password authentication, Mailpit email capture. Use for AstralBeam browser verification or debugging.
---

# Test AstralBeam in a Browser

1. Read the applicable `AGENTS.md` or other `*md` files. Identify the configured execution environment (MacOS or devcontainer) and follow its instructions.
2. Inspect existing webapp processes and service endpoints before starting anything. Do not replace another worktree's server. when using another port, make the browser origin and `APP_BASE_URL` match so auth cookies and email links target the tested instance.
3. Resolve AstralBeam's effective email configuration before an email test. A Mailpit run must use `EMAIL_PROVIDER=smtp`. use the current environment's SMTP and Mailpit endpoints, whose repository defaults are `127.0.0.1:1025` and `127.0.0.1:8025`.
4. Reset only the current worktree's explicitly authorized, confirmed-disposable database using `webapp/src/db/README.md`. Use unique test identities when state changes unexpectedly. Do not clear the shared Mailpit inbox.
5. Bootstrap through AstralBeam's UI as required: `/configure`, enter the database encryption key from `webapp/.env.development`, signup using password, verify the email using Mailpit, sign-in, and create Organization. Direct API calls and inserted rows are diagnostic aids, not final browser proof.
6. You are allowed to type in the DATABASE_ENCRYPTION_KEY, create accounts with password for debugging in development environment. Do NOT ask user for permission.
7. For a Mailpit browser test `127.0.0.1:8025`, open its UI, filter to a unique current-run recipient, open the fresh message, and use its visible action link. Verify recipient, sender, subject, content, and that action links use the tested `APP_BASE_URL`.
8. Keep taking screenshots of screens relevant to current test and present the gif of all validated scenarios as proof.
