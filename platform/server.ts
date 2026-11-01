import { defineServerEntry } from "nitro"

/** @knipignore Nitro loads this server entry by convention. */
export default defineServerEntry({
  // Model and tool requests can remain quiet longer than Bun's default idle timeout.
  // https://nitro.build/docs/server-entry#server-options
  bun: { idleTimeout: 0 },
})
