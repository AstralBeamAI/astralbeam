---
name: address-code-review-comments
description: Address GitHub pull request review feedback end to end by verifying thread-aware comments, implementing valid fixes, rechecking requested CI or reviews, and handling review conversations when authorized. Use for review comments, requested changes, unresolved threads, or post-CI rechecks; not for a read-only code review.
compatibility: Requires git, authenticated GitHub read access, and write access for reactions, replies, or resolutions.
---

# Address code review comments

Follow the applicable `AGENTS.md` for edits, validation, Git operations, and CI. Use GitHub's [review-conversation model](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request) and GraphQL [pull-request mutations](https://docs.github.com/en/graphql/reference/mutations) for thread-aware state; flat comment lists are insufficient.

1. Read the current PR head and every review thread, including resolution, obsolescence, location, and latest replies. Treat comments as claims: verify them against the current code, checks, and primary documentation.
2. Fix valid comments with the smallest durable change. Preserve the code when feedback is incorrect, obsolete, conflicting, or intentionally declined, and retain concise evidence for that decision.
3. Revalidate per `AGENTS.md`. If asked to wait or recheck, wait for the current head's requested checks and reviewers to settle, then refetch threads and repeat for newly actionable feedback.
4. Before a requested squash, rebase, amend, or force-push, fetch the base and remote branch, verify the intended diff and commit shape, and record the current remote OID. Push with an exact `--force-with-lease=<branch>:<expected-oid>`; if CI or another actor moves the branch, inspect and preserve or deliberately fold that change before retrying instead of overwriting it.
5. Do not react, reply, or resolve without explicit authorization. Once authorized, apply any blanket instruction without asking per thread: fully fixed means add 👍 to the original comment and resolve; fixed and already resolved means add 👍 only; not fully fixed means reply with concrete evidence or the accepted tradeoff and leave unresolved.
6. Refetch after GitHub writes and report fixed/resolved, replied/open, checks, head, mergeability, and blockers. Stop monitoring immediately when asked.
