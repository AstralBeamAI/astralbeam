// Names and events of the AstralBeam chat protocol, shared by every consumer: the styled
// widget, the headless core, and the endpoint (webapp/src/routes/api/chat); keep them in step.

// Client tools every chat mount declares to the agent: the endpoint forwards
// them verbatim and the host executes them in its page.
export const RENDER_WIDGET_TOOL = "render_widget"
export const ASK_QUESTIONNAIRE_TOOL = "ask_questionnaire"

// Server-side tools the chat endpoint adds when the agent has a sandbox provider configured.
// Clients never declare or execute these; they recognize the names to render each step.
export const SANDBOX_WRITE_FILE_TOOL = "sandbox_write_file"
export const SANDBOX_PUBLISH_ARTIFACT_TOOL = "sandbox_publish_artifact"
export const SANDBOX_READ_FILE_TOOL = "sandbox_read_file"
export const SANDBOX_LIST_FILES_TOOL = "sandbox_list_files"
export const SANDBOX_RUN_COMMAND_TOOL = "sandbox_run_command"

/** CUSTOM stream event carrying sandbox provisioning progress, which no tool result can report. */
export const SANDBOX_STATUS_EVENT = "astralbeam.sandbox.status"
