import { Layer } from "effect"

import { scheduledWorkflowsLayer } from "./cron.server.ts"
import { deleteOrganizationWorkflowLayer } from "./delete-organization.server.ts"

export const registeredWorkflowLayers = Layer.mergeAll(
  scheduledWorkflowsLayer,
  deleteOrganizationWorkflowLayer,
)
