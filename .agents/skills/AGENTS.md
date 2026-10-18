# Agent skills

- Follow [skill-creator](skill-creator/SKILL.md) before creating skills. Keep one canonical project copy at `.agents/skills/<name>`.
- Install only reviewed, project-scoped skills with `DISABLE_TELEMETRY=1 bunx --bun skills@latest add <source> --skill <name> --agent universal -y`. Never install globally.
