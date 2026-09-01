// The headless AstralBeam entry: everything the styled widget knows about the chat protocol,
// with no markup and no framework. `@astralbeam/sdk/react` builds `useAstralBeamChat` on it.

export {
  type AstralBeamChatCore,
  type AstralBeamChatCoreOptions,
  type AstralBeamChatState,
  createAstralBeamChat,
  type WidgetRenderRequest,
} from "./session.ts"
export type { ChatAuthenticationState } from "./auth.ts"
export { buildAgentTools, type WidgetDeclaration } from "./agent-tools.ts"
export { hasPendingToolRun, isSettledToolCall, lastPartInProgress } from "./messages.ts"
export {
  collectSandboxActivity,
  describeSandboxCommandRun,
  isSandboxTool,
  readSandboxArtifact,
  readSandboxCommandRun,
  readSandboxFileWrite,
  sandboxRefusal,
} from "./sandbox.ts"
export {
  ASK_QUESTIONNAIRE_TOOL,
  RENDER_WIDGET_TOOL,
  SANDBOX_LIST_FILES_TOOL,
  SANDBOX_PUBLISH_ARTIFACT_TOOL,
  SANDBOX_READ_FILE_TOOL,
  SANDBOX_RUN_COMMAND_TOOL,
  SANDBOX_STATUS_EVENT,
  SANDBOX_WRITE_FILE_TOOL,
} from "./protocol.ts"
export type {
  RenderWidgetInput,
  SandboxActivity,
  SandboxArtifact,
  SandboxCommandRun,
  SandboxFileWrite,
  SandboxStatus,
} from "./types.ts"
export { defineTool, defineWidget } from "../lib/define.ts"
export type {
  InferParameters,
  JsonSchemaObject,
  ParametersSchema,
  StandardSchemaV1,
  ToolDefinition,
} from "../lib/types.ts"
