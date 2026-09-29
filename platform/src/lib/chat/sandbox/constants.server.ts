import { APP_HANDLE } from "@/lib/constants"

/** Virtual workspace root TanStack providers map onto their own working directory. */
export const CHAT_SANDBOX_ROOT = "/workspace"

// A fresh cloud sandbox takes tens of seconds and a command can hang, so every step is bounded
// and the tool reports its timeout to the agent rather than failing the run.
export const CHAT_SANDBOX_START_TIMEOUT_MS = 120_000
// Artifact downloads: bounded separately from the model-context clamps, because a download's
// budget is transfer size, not tokens. The ticket lives exactly as long as an idle lease can.
export const CHAT_SANDBOX_MAX_ARTIFACT_BYTES = 10 * 1024 * 1024
export const CHAT_ARTIFACT_TICKET_LIFETIME_SECONDS = 15 * 60
export const CHAT_ARTIFACT_TICKET_AUDIENCE = `${APP_HANDLE}-artifact`
export const CHAT_ARTIFACT_TICKET_TYPE = `${APP_HANDLE}-artifact+jwt`
export const CHAT_SANDBOX_COMMAND_TIMEOUT_MS = 120_000
export const CHAT_SANDBOX_FILE_TIMEOUT_MS = 30_000

// Command output and file reads are model context, so both are capped with the middle elided,
// or a build log or a minified bundle would blow up the run.
export const CHAT_SANDBOX_MAX_OUTPUT_CHARACTERS = 20_000
export const CHAT_SANDBOX_MAX_FILE_CHARACTERS = 40_000
export const CHAT_SANDBOX_MAX_WRITE_CHARACTERS = 200_000
export const CHAT_SANDBOX_MAX_LISTED_ENTRIES = 200
export const CHAT_SANDBOX_MAX_PATH_LENGTH = 512

// Vendors bill live sandboxes, so one idle this long is destroyed, and the least recently used
// goes when the process already holds the cap.
export const CHAT_SANDBOX_IDLE_TTL_MS = 15 * 60_000
export const CHAT_SANDBOX_SWEEP_INTERVAL_MS = 60_000
export const CHAT_SANDBOX_MAX_LIVE = 25
// Shutdown destroys every live sandbox inside the server's 5-second deadline. The vendor reclaims
// any it misses.
export const CHAT_SANDBOX_SHUTDOWN_TIMEOUT_MS = 3_000

/** CUSTOM stream event carrying provisioning progress, which no tool result can report in time. */
export const CHAT_SANDBOX_STATUS_EVENT = `${APP_HANDLE}.sandbox.status`
