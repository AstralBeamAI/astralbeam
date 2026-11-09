---
name: release
description: Cut an AstralBeam release through a version-bump PR, green CI, merge, actual publication, and npm approval handoff. Use for explicit release requests, not explanations or plans.
compatibility: Requires git, Bun, network access, authenticated GitHub access for PRs, merges and Actions, and configured npm trusted publishers.
---

# Release

A release request authorizes the PR, merge, tag push, and publication. Leave npm approval and its 2FA to the user.

1. Read the [release guide](../../../CONTRIBUTING.md#releasing) and [workflow](../../../.github/workflows/release.yml). Fetch `main` and tags, then inspect changes since the latest published release. Before 1.0, choose minor for breaking changes and patch otherwise, or honor an explicit unused version.
2. Reuse a matching release PR, otherwise branch from `origin/main` as `release-<version>`. Bump SDK, CLI, and Platform together, refresh `bun.lock` with Bun, and update pinned SDK URLs and release image/Compose URLs. Find first-party pins with `git grep '<old-version>'`. Include only release preparation.
3. Review and publish through [create-github-pr](../create-github-pr/SKILL.md), including its required validation.
4. Wait for green CI and fix bump-related failures. Immediately before squash-merging, refetch the PR head, required checks, and reviews. Merge only the checked head with passing required checks and no actionable feedback.
5. Sync a clean `main` to the merged commit and require green CI. If `main` advanced, reassess intervening changes and version first. Run `bun run release -y` to trigger the actual Release workflow. Wait for the matching tag/SHA run to succeed and verify the GitHub release and image.
6. Extract both real stage IDs from that run's staging logs or summary, checking package names and version. Return PR, release, and run links, state npm approval is pending, and fill this copyable block with the real IDs. Do not execute it:

   ```sh
   npm stage approve <SDK_STAGE_ID>
   npm stage approve <CLI_STAGE_ID>
   ```

On failure or missing IDs, report the blocker and partial publication. Inspect existing tags, stages, releases, and runs before retrying. Never move a published tag or blindly repeat publishing.
