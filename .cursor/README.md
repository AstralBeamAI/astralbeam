# Cursor Cloud Agents

The checked-in [environment](environment.json) installs dependencies, starts Docker and the root Compose stack, exposes ports `4500`, `4600`, and `4700`, and opens both application terminals. Port `4700` is the todos example, which `bun run dev:todos` or the root `bun run dev` serves.

The `install` step installs workspace dependencies because Docker is not running yet. The `start` step starts Docker and runs `SERVICES=docker ./scripts/setup.sh` to initialize services and the workspace.

In the Cursor dashboard:

- Grant the GitHub app read/write access only to `AstralBeamAI/astralbeam` and enable Privacy Mode.
- Enable automatic CI repair when available. Otherwise use `@cursor fix the CI failures`.

See [Cursor setup](https://cursor.com/docs/cloud-agent/setup), [capabilities](https://cursor.com/docs/cloud-agent/capabilities), and [network security](https://cursor.com/docs/cloud-agent/security-network).
