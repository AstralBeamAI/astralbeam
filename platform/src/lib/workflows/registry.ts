import { Layer } from "effect"

import { purgeFileWorkflowLayer } from "./purge-file.ts"
import { scheduledWorkflowsLayer } from "./cron.ts"
import { deleteOrganizationWorkflowLayer } from "./delete-organization.ts"
import { modelPriceCatalogInitializationLayer } from "./model-price-catalog-refresh.ts"

export const registeredWorkflowLayers = Layer.mergeAll(
  scheduledWorkflowsLayer,
  purgeFileWorkflowLayer,
  deleteOrganizationWorkflowLayer,
  modelPriceCatalogInitializationLayer,
)
