# Codex

Codex desktop automatically uses [`environments/environment.toml`](environments/environment.toml) to set up new local worktrees and expose the application and validation actions.

Cloud lifecycle settings are configured in Codex Settings rather than a repository manifest. Connect only `AstralBeamAI/astralbeam`, create an `astralbeam` environment, use `INSTALL_EXTRA=codex-db SKIP_DOCKER_COMPOSE=true bash scripts/setup.sh` for both setup and maintenance so the Ubuntu environment installs and starts host PostgreSQL and Valkey through the explicit setup extra, add no secrets, and leave agent internet access off. Enable repository code review and automatic reviews & use `@codex review` for retries or focused reviews.

See [Codex environment modes](https://learn.chatgpt.com/docs/environments/modes), [cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment), [agent internet access](https://learn.chatgpt.com/docs/cloud/internet-access), and [GitHub integration](https://learn.chatgpt.com/docs/third-party/github).
