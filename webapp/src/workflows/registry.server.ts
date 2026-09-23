import { Layer } from "effect"
import { exampleWorkflow, exampleWorkflowLayer } from "./example.server.ts"

export const workflowDefinitions = [exampleWorkflow] as const
export const workflowHandlersLayer = Layer.mergeAll(exampleWorkflowLayer)
