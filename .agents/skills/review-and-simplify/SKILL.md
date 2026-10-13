---
name: review-and-simplify
description: Review a change for correctness, requirement coverage, and unnecessary complexity, and simplify it when edits are authorized. Use for explicit thorough reviews, final-diff reviews, or requests to shorten a diff or remove redundant code and low-value tests. Use address-code-review-comments for existing GitHub feedback. Ordinary implementation needs only proportionate self-review, not this full workflow.
---

# Review and simplify

1. Read applicable instructions, the actual review target, and the user's still-applicable requests, corrections, and accepted decisions. Record the comparison's base and head, include relevant uncommitted changes, and give delegated reviewers the same diff. Infer an evident target from context. Ask only when ambiguity changes the review.
2. Match depth to scope and risk. Inspect the final behavior, relevant callers, tests, generated artifacts, and consumer documentation. For affected stateful behavior, check supported entry points and reverse or recovery transitions within the agreed scope, such as enable/disable and mount/unmount. Verify assumptions against installed APIs and primary sources where needed. Prioritize demonstrable defects and missing requirements over style preferences.
3. Question incidental renames, redundant configuration, one-use wrappers, speculative options, defensive branches, and tests of library guarantees. Derive test expectations from the behavior contract or independently worked examples, rather than repeating the production calculation. Preserve meaningful regression coverage, security and persistence boundaries, useful documentation, and established names and structure. Apply the project's simplification and test-value rules rather than optimizing line count alone.
4. Keep review-only requests read-only. When fixes or simplification are authorized, make narrow changes in the requested path and preserve unrelated work. Review alone does not authorize publishing, merging, or GitHub comments. Route existing GitHub feedback to [address-code-review-comments](../address-code-review-comments/SKILL.md).
5. Follow the project's validation rules and reuse relevant evidence for unchanged code. Use [test-platform-in-browser](../test-platform-in-browser/SKILL.md) for AstralBeam browser proof. Beyond required checks, rerun or broaden validation only for changed behavior, failures, or unresolved concerns.
6. Recheck the final diff and requirement coverage after edits, then stop unless new findings warrant another pass. Report actionable findings or completed fixes, actual validation, and anything deferred, declined, blocked, or unverified with its reason. Do not revive superseded requests or explicitly deferred work.

For additional review techniques, consult Matt Pocock's [code-review skill](https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md). Apply this project's scope and validation rules.
