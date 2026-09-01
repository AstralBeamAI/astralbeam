import { describeSandboxCommandRun } from "../../core/sandbox.ts"
import type { SandboxCommandRun } from "../../core/types.ts"
import { SandboxCodeBlock } from "./sandbox-code.tsx"

/**
 * One command's terminal session: the command itself, then its output. Providers whose blocking
 * exec has no separate stderr channel return everything on stdout, so `stderr` only gets a block
 * of its own when it actually has something in it.
 */
export function SandboxCommandLog({ run }: { run: SandboxCommandRun }) {
  if (!run.finished) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <SandboxCodeBlock>{`$ ${run.command}`}</SandboxCodeBlock>
        <p className="text-xs text-muted-foreground italic">Still running…</p>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <SandboxCodeBlock>{`$ ${run.command}`}</SandboxCodeBlock>
      {!run.timedOut && <SandboxCodeBlock emptyLabel="No output">{run.stdout}</SandboxCodeBlock>}
      {run.stderr.length > 0 && <SandboxCodeBlock tone="error">{run.stderr}</SandboxCodeBlock>}
      <p className="text-xs text-muted-foreground">{describeSandboxCommandRun(run)}</p>
    </div>
  )
}
