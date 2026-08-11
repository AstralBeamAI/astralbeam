---
name: create-github-pr
description: Use this skill when the user explicitly asks to create or publish a GitHub pull request from local repository changes. Confirm scope, publish the intended diff, synthesize a concise title and bullet-only description from relevant user chat, push the branch, publish ready for review by default and use draft only when explicitly requested, prevent duplicates, and verify the created PR. If PR creation fails for any reason after the branch is pushed, still hand the user copyable title and description. Do not use for text-only PR drafts, reviews, comments, or CI repair.
compatibility: Requires git, network access, and authenticated GitHub write access through the GitHub CLI or an equivalent GitHub connector.
---

# Create GitHub PR

Publish the intended local change set as a verified GitHub pull request. Use ordinary git and GitHub mechanics; retain only the non-obvious rules below.

## Workflow

1. Read applicable repository instructions and PR templates, inspect the full proposed change and target, and check whether the head already has an open PR. Report an existing PR instead of creating a duplicate; edit it only when requested.
2. Confirm scope, leave clearly separable user work untouched, follow repository conventions, run required checks, then commit the intended changes without rewriting history.
3. Compose the title and description using the content contract below before attempting publish, so they remain available if create fails.
4. Push the branch to the remote with upstream tracking. Do not skip this step when later PR creation is expected to fail; a pushed head plus copyable text is the recovery path.
5. Create the PR ready for review unless the user explicitly requested a draft. Prefer an authenticated GitHub connector that can create and read PRs; otherwise use [`gh pr create`](https://cli.github.com/manual/gh_pr_create) with a body file so Markdown is preserved.
6. On any PR creation failure (auth, permissions, API, ambiguous create, or missing tooling), check for a newly created PR before retrying. If none exists, report the blocker without requesting credentials in chat, then output the already-composed title and description as separate copyable fenced blocks so the user can open the PR manually from the pushed branch:
   ```text
   <title>
   ```

   ```markdown
   <description>
   ```
7. On success, read the PR back from GitHub, verify its URL, title, state, base, and head, then report those values with the commit and check results. Claim success only after that remote read-back.

## Content contract

- Review the proposed diff, every included commit's subject and body relative to the target branch, and relevant user-authored chat messages before drafting. Extract intent, constraints, corrections, accepted decisions, terminology, and links; keep the final diff authoritative over reverted or superseded commit details.
- Use one concise, imperative title that summarizes the whole change.
- Write the description as concise Markdown bullets only, nesting when useful. Do not add headings, prose sections, checklists, validation commands, or test results.
- Prefer relevant links already supplied by the user or discovered in the current conversation and place them inline in the supporting bullet. Do not add a references section, revive superseded context, or invent links.
- Honor compatible repository template requirements; ask before creating the PR if a mandatory template conflicts with this format. Use issue-closing keywords only for a verified issue the user intends to close.

## Guardrails

- Only an explicit request to create or publish a PR authorizes commits, pushes, and PR creation.
- Never stage unrelated work or stash, discard, amend, rebase, squash, or force-push without explicit authorization.
- Fix or stop for a required check broken by the change. A demonstrably pre-existing or environmental failure may proceed in the requested PR state and belongs in the handoff, not the PR description.
- Do not add reviewers, assignees, labels, milestones, or projects unless requested or required by repository instructions.
- If push fails, stop after reporting the blocker; still output the copyable title and description so the user can finish once auth or network is fixed.
- Never omit the copyable title and description after a failed create when those fields were already composed.
