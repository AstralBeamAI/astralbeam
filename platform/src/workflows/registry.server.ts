import { Layer } from "effect"

import { scheduledWorkflowsLayer } from "./cron.ts"
import { deleteOrganizationWorkflowLayer } from "./delete-organization.ts"

export const registeredWorkflowLayers = Layer.mergeAll(
  scheduledWorkflowsLayer,
  deleteOrganizationWorkflowLayer,
)
