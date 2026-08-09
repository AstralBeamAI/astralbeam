# Agent skills

- Before creating a skill, follow `skill-creator` and research current registries, relevant repositories, local skills, and primary documentation; prefer reuse or improvement over duplication.
- Keep one portable project copy at `.agents/skills/<name>` and link maintained remote references instead of copying them locally; retain only durable instructions and optional client metadata that does not alter core behavior.
- Install reviewed skills project-scoped with `DISABLE_TELEMETRY=1 vp dlx skills@latest add <source> --skill <name> --agent universal -y`; do not install the CLI or skills globally.
