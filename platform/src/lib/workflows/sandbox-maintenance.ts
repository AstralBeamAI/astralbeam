import { Effect } from "effect"

import { SandboxResources } from "../sandboxes/resources.server"

const sandboxMaintenance = Effect.flatMap(SandboxResources, (resources) => resources.reap())

export default sandboxMaintenance
