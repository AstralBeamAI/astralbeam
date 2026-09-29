import { CHAT_SANDBOX_ROOT } from "./constants.server"

/** A result the agent should read and correct, rather than a broken sandbox. */
export interface SandboxRefusal {
  refusal: string
}

/** An absolute path inside the workspace, plus the shorter form a label reads better with. */
interface SandboxResolvedPath {
  path: string
  relativePath: string
}

/**
 * The absolute path a tool acts on, kept inside the sandbox's workspace.
 *
 * `root` is the provider's REAL workspace directory, from `resolveHarnessCwd`. That matters
 * because the agent writes paths into command strings, where nothing maps them: Daytona's
 * `/workspace` is really `/home/daytona/workspace`, so `python3 /workspace/app.py` would not find
 * the file `sandbox_write_file` just wrote there. Every result therefore reports a real path — and
 * a virtual `/workspace` one is still translated, since the agent may type it anyway.
 *
 * Containment is not the security boundary; the sandbox is. It stops the agent overwriting the
 * image's own files and keeps the widget's file list coherent.
 */
export function resolveSandboxPath(
  root: string,
  path: string,
): SandboxResolvedPath | SandboxRefusal {
  const normalized = normalizeSandboxPath(path.startsWith("/") ? path : `${root}/${path}`)
  const mapped =
    root !== CHAT_SANDBOX_ROOT && isUnderSandboxRoot(CHAT_SANDBOX_ROOT, normalized)
      ? `${root}${normalized.slice(CHAT_SANDBOX_ROOT.length)}`
      : normalized
  if (!isUnderSandboxRoot(root, mapped)) {
    return {
      refusal: `Only paths inside ${root} can be used here. Reach anything else with a command.`,
    }
  }
  // The relative form is what the widget labels a row with — a real absolute path wraps over two
  // lines in a sidebar — and is also the shorter thing for the agent to type against the default
  // working directory.
  return { path: mapped, relativePath: mapped === root ? "." : mapped.slice(root.length + 1) }
}

/** Resolves `.` and `..` before containment, so a traversal cannot climb out of the root. */
function normalizeSandboxPath(absolute: string): string {
  const segments: string[] = []
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join("/")}`
}

function isUnderSandboxRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`)
}
