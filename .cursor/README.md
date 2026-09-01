# Cursor Cloud Agents

The checked-in [environment](environment.json) installs dependencies, starts Docker and the root Compose stack, exposes ports `4500` and `4600`, and opens both application terminals.

In the Cursor dashboard:

- Grant the GitHub app read/write access only to `AstralBeamAI/astralbeam` and enable Privacy Mode.
- Enable automatic CI repair when available; otherwise use `@cursor fix the CI failures`.

See [Cursor setup](https://cursor.com/docs/cloud-agent/setup), [capabilities](https://cursor.com/docs/cloud-agent/capabilities), and [network security](https://cursor.com/docs/cloud-agent/security-network).
