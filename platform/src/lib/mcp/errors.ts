import { Schema } from "effect"
import { MCP_PROTOCOL_VERSION } from "./schemas.ts"

export class McpForbidden extends Schema.TaggedError<McpForbidden>()(
  "McpForbidden",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "You cannot use or manage this MCP connection."
}
export class McpNotFound extends Schema.TaggedError<McpNotFound>()(
  "McpNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "The MCP server or connection was not found."
}
export class McpChanged extends Schema.TaggedError<McpChanged>()(
  "McpChanged",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "The MCP configuration changed. Refresh and try again."
}
export class McpInvalidConfiguration extends Schema.TaggedError<McpInvalidConfiguration>()(
  "McpInvalidConfiguration",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "Use a public HTTPS endpoint and supported authentication settings."
}
export class McpAuthorizationRequired extends Schema.TaggedError<McpAuthorizationRequired>()(
  "McpAuthorizationRequired",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "Connect this MCP account again to continue."
}
export class McpUnavailable extends Schema.TaggedError<McpUnavailable>()(
  "McpUnavailable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "The MCP server is unavailable. Check the connection and try again."
}

export class McpUnsupportedProtocol extends Schema.TaggedError<McpUnsupportedProtocol>()(
  "McpUnsupportedProtocol",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = `Could not connect using MCP ${MCP_PROTOCOL_VERSION}. Check the server URL and confirm it supports this version over Streamable HTTP.`
}
