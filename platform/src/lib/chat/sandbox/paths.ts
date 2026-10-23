import { posix } from "node:path"

import { CHAT_SANDBOX_ROOT } from "./constants"

/** A result the agent should read and correct, rather than a broken sandbox. */
export interface SandboxRefusal {
  refusal: string
}

/** An absolute path inside the workspace, plus the shorter form a label reads better with. */
interface SandboxResolvedPath {
  path: string
  relativePath: string
}

/** The real path under `root`, the provider's own workspace from `resolveHarnessCwd`, because
 * commands see real paths. A virtual `/workspace` path is translated. The sandbox is the boundary. */
export function resolveSandboxPath(
  root: string,
  path: string,
): SandboxResolvedPath | SandboxRefusal {
  const normalized = posix.resolve(root, path)
  const mapped =
    root !== CHAT_SANDBOX_ROOT && isUnderSandboxRoot(CHAT_SANDBOX_ROOT, normalized)
      ? `${root}${normalized.slice(CHAT_SANDBOX_ROOT.length)}`
      : normalized
  if (!isUnderSandboxRoot(root, mapped)) {
    return {
      refusal: `Only paths inside ${root} can be used here. Reach anything else with a command.`,
    }
  }
  // The widget labels a row with the relative form, which also is shorter for the agent to type
  // against the default working directory.
  return { path: mapped, relativePath: mapped === root ? "." : mapped.slice(root.length + 1) }
}

function isUnderSandboxRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`)
}
