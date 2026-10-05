---
name: create-github-pr
description: Create and verify a GitHub pull request when explicitly asked to publish local changes. Maintain its project metrics comment during authorized PR updates or explicit refreshes. Preserve scope, use a concise title and bullet-only body, and provide copyable text if publication fails. Do not use for text-only drafts, read-only reviews, unrelated comments, or CI repair.
compatibility: Requires git, network access, and authenticated GitHub write access through the GitHub CLI or an equivalent GitHub connector. Browser-based walkthrough uploads also require an authenticated GitHub web session.
---

# Create GitHub PR

Publish only the intended local changes, following repository instructions and the content contract below.

For authorized updates to an existing PR or explicit metrics refreshes, use the project metrics section without repeating the creation workflow.

## Workflow

1. Read applicable repository instructions and PR templates, inspect the full proposed change and target, and check whether the head already has an open PR. Report an existing PR instead of creating a duplicate. Edit its title or description only when requested.
2. Use an applicable current plan already present in the task context and read materially related checked-out `*.plan.md` files, if any. Treat plans as optional intent context, never implementation evidence. Do not create, update, or require a plan to publish a PR.
3. Confirm scope, leave clearly separable user work untouched, follow repository conventions, run required checks, then commit the intended changes without rewriting history.
4. Compose the title and description using the content contract below before attempting publish, so they remain available if create fails.
5. Push the branch to the remote with upstream tracking. Do not skip this step when later PR creation is expected to fail. A pushed head plus copyable text is the recovery path.
6. Create the PR ready for review unless the user explicitly requested a draft. Prefer an authenticated GitHub connector that can create and read PRs. Otherwise use [`gh pr create`](https://cli.github.com/manual/gh_pr_create) with a body file so Markdown is preserved.
7. On any PR creation failure (auth, permissions, API, ambiguous create, or missing tooling), check for a newly created PR before retrying. If none exists, report the blocker without requesting credentials in chat, then output the already-composed title and description as separate copyable fenced blocks so the user can open the PR manually from the pushed branch:
   ```text
   <title>
   ```

   ```markdown
   <description>
   ```
8. On success, read the PR back from GitHub, verify its URL, title, state, base, and head, then report those values with the commit and check results. Claim success only after that remote read-back. Immediately after the read-back, post the project metrics comment below, aiming for the first conversation comment, and include its URL in the handoff.
9. Attach an approved walkthrough through the workflow below, then verify the saved attachment on GitHub.

## Project metrics comment

- Keep one conversation comment starting with `<!-- astralbeam-pr-metrics -->` and `## Project metrics`. Post metrics in a Markdown table with `Metric`, `Base`, `Head`, and `Delta` columns, including the project name in each metric label, for handwritten source lines, generated source lines, test lines, and build size of affected `platform`, `sdk`, and `cli` projects, including shared build inputs. Remove unaffected rows, or state that no measured projects are affected.
- Fetch the PR's current base and head. Compare the head with their merge base, recording the target branch, base SHA, merge-base SHA, and head SHA in the comment.
- Build clean, isolated snapshots with the same OS, architecture, Deno version, and options, using each revision's frozen dependencies. Run `deno task --cwd <project> count-lines` even if a build fails. Reuse measurements, including `ready` output, only for matching commits and environments. Use build sizes only from successful builds.
- Publish signed head-minus-baseline deltas using the task's units and precision. Publish available metrics when a measurement fails, marking missing values and their deltas `Unavailable` with a short reason.
- Paginate conversation comments and locate the comment starting with the marker. Update it by ID when editable, creating one only if absent. Use a connector or GitHub's [issue-comment API](https://docs.github.com/en/rest/issues/comments#update-an-issue-comment) with a structured body or body file. Avoid `gh pr comment --edit-last`, which may overwrite another reply. Refetch after ambiguous creation failures before retrying.
- Refresh after every authorized push and observed target/base change. Recompute affected rows and provenance, skip unchanged writes, and recheck remote base/head before writing. Recompute if they moved.
- Read the saved comment back and verify its body, comparison SHAs, and URL against the current PR. On comment access failure, report the blocker and provide copyable Markdown. Report PR creation and metrics publication separately.

## Walkthrough videos

- Before upload, watch the complete recording and reject or redact anything containing credentials, tokens, personal data, private notifications, unrelated tabs, or other sensitive material. Treat every generated attachment URL as shareable bearer-access media, including on a private repository. See GitHub's [anonymized URL guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls).
- Keep the source and any transcoded copy outside the repository worktree. Confirm neither appears in `git status --short`, the index, tracked files, or Git LFS, and never copy, stage, commit, or push walkthrough media. A repository ignore rule is not a substitute for keeping the artifact outside the worktree.
- Prefer an H.264-encoded `.mp4` for browser compatibility. GitHub's [supported formats and limits](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files#supported-file-types) also allow `.mov` and `.webm` and currently cap videos at 10 MB on free plans or 100 MB on paid plans. Uploads over 10 MB additionally require the uploader to meet GitHub's paid-plan or repository-access eligibility rules.
- Prefer [`gh pr create --attach`](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli) or `gh pr comment <number> --attach './file.mp4#alt text'`, which uploads the media and rewrites a matching body reference to the uploaded asset. It needs gh 2.97 or newer and push access. Screenshots go the same way.
- Without that flag, open the created PR in an authenticated GitHub web session, edit its description, drag the video into the description editor or use **Attach files**, and wait for GitHub to finish uploading and insert its anonymized attachment URL. Place the generated attachment inline with the walkthrough bullet, preserve the rest of the intended description, save, reload the PR, and confirm the video player renders and plays.
- If GitHub rejects or cannot upload the video, keep the artifact outside the worktree and report its absolute local path and the blocker. Transcode outside the worktree and retry only when authorized. Never commit the recording or add Git LFS as a fallback.

## Content contract

- Review the authoritative proposed diff, every included commit's subject and body relative to the target branch, relevant user-authored chat, and any applicable current plan before drafting. Extract intent, constraints, corrections, accepted decisions, terminology, and links. The final diff and later user instructions override older plans, reverted work, and superseded commit details. Never claim an unimplemented plan item.
- Use one concise, imperative title that summarizes the whole change.
- Write the description as concise Markdown bullets only, nesting when useful. Do not add headings, prose sections, checklists, validation commands, or test results. GitHub-generated attachment markup may sit inside the walkthrough bullet when required for an inline player. This is the only formatting exception.
- Prefer relevant links already supplied by the user or discovered in the current conversation and place them inline in the supporting bullet. Do not add a references section, revive superseded context, or invent links.
- Honor compatible repository template requirements. Ask before creating the PR if a mandatory template conflicts with this format. Use issue-closing keywords only for a verified issue the user intends to close.

## Guardrails

- Only an explicit request to create or publish a PR authorizes commits, pushes, and PR creation.
- Authorized PR creation and updates include metrics upkeep. A metrics-only request authorizes only that comment.
- Never stage unrelated work or stash, discard, amend, rebase, squash, or force-push without explicit authorization.
- Fix or stop for a required check broken by the change. A demonstrably pre-existing or environmental failure may proceed in the requested PR state and belongs in the handoff, not the PR description.
- Do not add reviewers, assignees, labels, milestones, or projects unless requested or required by repository instructions.
- If push fails, stop after reporting the blocker. Still output the copyable title and description so the user can finish once auth or network is fixed.
