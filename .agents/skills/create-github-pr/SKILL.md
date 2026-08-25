---
name: create-github-pr
description: Use this skill when the user explicitly asks to create or publish a GitHub pull request from local repository changes. Confirm scope, publish the intended diff, synthesize a concise title and bullet-only description from the authoritative diff, relevant commits and user chat, plus any applicable current plan, push the branch, publish ready for review by default and use draft only when explicitly requested, prevent duplicates, and verify the created PR. If PR creation fails after the branch is pushed, still hand the user copyable title and description. Do not use for text-only PR drafts, reviews, comments, or CI repair.
compatibility: Requires git, network access, and authenticated GitHub write access through the GitHub CLI or an equivalent GitHub connector. Walkthrough uploads also require an authenticated GitHub web session.
---

# Create GitHub PR

Publish the intended local change set as a verified GitHub pull request. Use ordinary git and GitHub mechanics; retain only the non-obvious rules below.

## Workflow

1. Read applicable repository instructions and PR templates, inspect the full proposed change and target, and check whether the head already has an open PR. Report an existing PR instead of creating a duplicate; edit it only when requested.
2. Use an applicable current plan already present in the task context and read materially related checked-out `*.plan.md` files, if any. Treat plans as optional intent context, never implementation evidence. Do not create, update, or require a plan to publish a PR.
3. Confirm scope, leave clearly separable user work untouched, follow repository conventions, run required checks, then commit the intended changes without rewriting history.
4. Compose the title and description using the content contract below before attempting publish, so they remain available if create fails.
5. Push the branch to the remote with upstream tracking. Do not skip this step when later PR creation is expected to fail; a pushed head plus copyable text is the recovery path.
6. Create the PR ready for review unless the user explicitly requested a draft. Prefer an authenticated GitHub connector that can create and read PRs; otherwise use [`gh pr create`](https://cli.github.com/manual/gh_pr_create) with a body file so Markdown is preserved.
7. On any PR creation failure (auth, permissions, API, ambiguous create, or missing tooling), check for a newly created PR before retrying. If none exists, report the blocker without requesting credentials in chat, then output the already-composed title and description as separate copyable fenced blocks so the user can open the PR manually from the pushed branch:
   ```text
   <title>
   ```

   ```markdown
   <description>
   ```
8. On success, read the PR back from GitHub, verify its URL, title, state, base, and head, then report those values with the commit and check results. Claim success only after that remote read-back.
9. When an approved walkthrough video exists, attach it after PR creation through the authenticated GitHub web description editor by following the walkthrough workflow below, then read the PR back again and verify the saved attachment.

## Walkthrough videos

- Before upload, watch the complete recording and reject or redact anything containing credentials, tokens, personal data, private notifications, unrelated tabs, or other sensitive material. Treat every generated attachment URL as shareable bearer-access media, including on a private repository; see GitHub's [anonymized URL guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls).
- Keep the source and any transcoded copy outside the repository worktree. Confirm neither appears in `git status --short`, the index, tracked files, or Git LFS, and never copy, stage, commit, or push walkthrough media. A repository ignore rule is not a substitute for keeping the artifact outside the worktree.
- Prefer an H.264-encoded `.mp4` for browser compatibility. GitHub's [supported formats and limits](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files#supported-file-types) also allow `.mov` and `.webm` and currently cap videos at 10 MB on free plans or 100 MB on paid plans; uploads over 10 MB additionally require the uploader to meet GitHub's paid-plan or repository-access eligibility rules.
- Open the created PR in an authenticated GitHub web session, edit its description, drag the video into the description editor or use **Attach files**, and wait for GitHub to finish uploading and insert its anonymized attachment URL. Place the generated attachment inline with the walkthrough bullet, preserve the rest of the intended description, save, reload the PR, and confirm the video player renders and plays.
- If GitHub rejects or cannot upload the video, keep the artifact outside the worktree and report its absolute local path and the blocker. Transcode outside the worktree and retry only when authorized; never commit the recording or add Git LFS as a fallback.

## Content contract

- Review the authoritative proposed diff, every included commit's subject and body relative to the target branch, relevant user-authored chat, and any applicable current plan before drafting. Extract intent, constraints, corrections, accepted decisions, terminology, and links. The final diff and later user instructions override older plans, reverted work, and superseded commit details; never claim an unimplemented plan item.
- Use one concise, imperative title that summarizes the whole change.
- Write the description as concise Markdown bullets only, nesting when useful. Do not add headings, prose sections, checklists, validation commands, or test results. GitHub-generated attachment markup may sit inside the walkthrough bullet when required for an inline player; this is the only formatting exception.
- Prefer relevant links already supplied by the user or discovered in the current conversation and place them inline in the supporting bullet. Do not add a references section, revive superseded context, or invent links.
- Honor compatible repository template requirements; ask before creating the PR if a mandatory template conflicts with this format. Use issue-closing keywords only for a verified issue the user intends to close.

## Guardrails

- Only an explicit request to create or publish a PR authorizes commits, pushes, and PR creation.
- Never stage unrelated work or stash, discard, amend, rebase, squash, or force-push without explicit authorization.
- Never commit walkthrough recordings or add them to Git LFS, even temporarily.
- Fix or stop for a required check broken by the change. A demonstrably pre-existing or environmental failure may proceed in the requested PR state and belongs in the handoff, not the PR description.
- Do not add reviewers, assignees, labels, milestones, or projects unless requested or required by repository instructions.
- If push fails, stop after reporting the blocker; still output the copyable title and description so the user can finish once auth or network is fixed.
- Never omit the copyable title and description after a failed create when those fields were already composed.
