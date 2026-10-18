# Agent skills

- Follow `skill-creator` before creating skills. Research registries, repositories, local skills, and primary docs, preferring reuse. Keep one portable `.agents/skills/<name>` copy with durable instructions and behavior-neutral optional metadata. Link maintained remote references.
- Install only reviewed, project-scoped skills with `DISABLE_TELEMETRY=1 bunx --bun skills@latest add <source> --skill <name> --agent universal -y`. Never install globally.
