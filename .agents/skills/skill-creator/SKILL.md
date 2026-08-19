---
name: skill-creator
description: Create, update, review, evaluate, package, source, and distribute portable Agent Skills. Use when turning a workflow into a reusable skill, editing or auditing SKILL.md, adding bundled resources or client metadata, comparing public skills, validating or packaging a skill, testing it against realistic prompts or a baseline, or improving its trigger description.
license: Apache-2.0
compatibility: Portable across Agent Skills-compatible runtimes. Remote guidance benefits from network access; bundled helpers require Python 3 and PyYAML.
---

# Skill Creator

Build one standards-based skill folder that works unchanged across compatible agents.

## Use current sources

Before authoring or reviewing, read the current [Agent Skills specification](https://agentskills.io/specification) and [creator best practices](https://agentskills.io/skill-creation/best-practices). When relevant, also read:

- [Using scripts](https://agentskills.io/skill-creation/using-scripts) before adding executable helpers.
- [Evaluating skills](https://agentskills.io/skill-creation/evaluating-skills) and [optimizing descriptions](https://agentskills.io/skill-creation/optimizing-descriptions) for evaluation or iteration.
- Vercel's [skills CLI](https://github.com/vercel-labs/skills) and [distribution guide](https://vercel.com/kb/guide/agent-skills-creating-installing-and-sharing-reusable-agent-context) for sourcing, installation, updates, or publishing.
- The current default-branch [OpenAI](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md) and [Anthropic](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) creators when comparing or refreshing upstream practices; use immutable revisions only for provenance.
- OpenAI's current default-branch [`agents/openai.yaml` reference](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/references/openai_yaml.md) before changing that optional adapter.

If remote documentation is unavailable, follow the portable invariants below and the bundled validator. `NOTICE.txt` records the immutable OpenAI and Anthropic source revisions merged into this derivative.

## Workflow

1. For a new skill, start with market research: search current skill registries with `deno run -A npm:skills@latest find <query>`, relevant repositories, local skills, and maintained primary documentation. Compare scope, maintenance, adoption, license, portability, dependencies, and security; record sources and prefer reuse or improvement over duplication.
2. Read the conversation, target skill, direct references, author instructions, provenance or lock data, and current diff.
3. Decide whether the workflow belongs in an on-demand skill; keep rules that apply to nearly every task in `AGENTS.md` or its equivalent.
4. Capture two or three realistic requests, expected outcomes, near-misses, dependencies, permissions, failure recovery, and verification.
5. Ground instructions in completed tasks, corrections, project artifacts, failures, and primary documentation. Keep only knowledge an agent would otherwise miss.
6. Choose the smallest useful structure: `SKILL.md` is required; add `scripts/`, `references/`, or `assets/` only when they improve execution; keep client enhancements under `agents/`.

## Portable invariants

- Treat `SKILL.md` and relative resources as the behavioral source of truth. Never rewrite core behavior for a detected harness; optional client metadata may be ignored without changing the workflow.
- Use only specification-defined frontmatter. The folder and `name` must match; `description` must say what the skill does and when to use it; state actual compatibility requirements rather than assuming a product.
- Keep `SKILL.md` concise, imperative, and generally below 500 lines and 5,000 tokens. Link maintained remote specifications and documentation instead of copying them locally; retain only durable workflow, project policy, offline-critical guidance, and reusable resources, and state when each link should be read.
- Match specificity to risk. Put non-obvious gotchas and security-critical warnings beside the relevant step; disclose dependencies, network access, credentials, permissions, side effects, and recovery.
- Prefer clear defaults over menus. Use tested, non-interactive scripts only for deterministic or repeated work.
- Before sourcing a skill, review its resolved source, license, instructions, references, scripts, and update diff. Run `deno run -A npm:skills@latest` ephemerally and select `--agent universal`; do not let detected harnesses change the canonical content or destination.

## Initialize and author

Skip initialization for an existing skill.

```bash
python3 <skill-creator-dir>/scripts/init_skill.py <skill-name> --path <output-directory> [--resources scripts,references,assets] [--examples]
```

Remove every placeholder. Generate optional OpenAI presentation metadata with `scripts/generate_openai_yaml.py`; the adapter may improve a supporting client but must not become required behavior.

## Validate and improve

1. Run `python3 <skill-creator-dir>/scripts/quick_validate.py <skill-directory>`.
2. Run every changed helper on representative success and invalid-input cases, inspect the tree and diff for unsafe or generated content, and run the repository's checks.
3. Run a realistic smoke test. For justified comparisons, use fresh contexts and identical prompts; compare a new skill with no skill and an update with its prior version. Use blind comparison or repeated runs only when their cost and decision value warrant them.
4. Generalize from observed failures and feedback; remove instructions that waste work or merely restate general knowledge.

Package only when requested:

```bash
python3 <skill-creator-dir>/scripts/package_skill.py <skill-directory> [output-directory]
```

Report changed files, evidence, assumptions, dependencies, and provenance. Give a representative invocation without assuming harness-specific syntax.
