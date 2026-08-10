---
name: create-github-pr
description: Use this skill when the user explicitly asks to create or publish a GitHub pull request from local repository changes. Confirm scope, publish the intended diff, synthesize a concise title and bullet-only description from relevant user chat, publish ready for review by default and use draft only when explicitly requested, prevent duplicates, and verify the created PR. Do not use for text-only PR drafts, reviews, comments, or CI repair.
compatibility: Requires git, network access, and authenticated GitHub write access through the GitHub CLI or an equivalent GitHub connector.
---

# Create GitHub PR

Publish the intended local change set as a verified GitHub pull request. Use ordinary git and GitHub mechanics; retain only the non-obvious rules below.

## Workflow

1. Read applicable repository instructions and PR templates, inspect the full proposed change and target, and check whether the head already has an open PR. Report an existing PR instead of creating a duplicate; edit it only when requested.
2. Confirm scope, leave clearly separable user work untouched, follow repository conventions, run required checks, then commit and push the intended changes without rewriting history.
3. Compose the title and description using the content contract below.
4. Create the PR ready for review unless the user explicitly requested a draft. Prefer an authenticated GitHub connector that can create and read PRs; otherwise use [`gh pr create`](https://cli.github.com/manual/gh_pr_create) with a body file so Markdown is preserved.
5. Read the PR back from GitHub, verify its URL, title, state, base, and head, then report those values with the commit and check results.

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
- If GitHub access is unavailable, report the blocker without requesting credentials in chat. After an ambiguous create error, check for a new PR before retrying.
- Claim success only after remote read-back confirms the PR.
