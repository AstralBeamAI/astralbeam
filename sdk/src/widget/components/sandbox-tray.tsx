import {
  CaretRightIcon,
  CubeIcon,
  FileTextIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/widget/components/ui/collapsible"
import { Spinner } from "@/widget/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/widget/components/ui/tabs"
import { describeSandboxCommandRun } from "../lib/sandbox.ts"
import type { SandboxActivity, SandboxStatus } from "../lib/types.ts"
import { SandboxCodeBlock } from "./sandbox-code.tsx"
import { SandboxCommandLog } from "./sandbox-command-log.tsx"
import { ToolDisclosure } from "./tool-disclosure.tsx"

interface SandboxTrayProps {
  activity: SandboxActivity
  status: SandboxStatus | undefined
}

/**
 * The conversation's whole sandbox, above the composer. The transcript shows each step where it
 * happened; this answers the other question — what is in the sandbox now, and what every command
 * printed. It sits in the footer because the header is optional (`showHeader: false`), and expands
 * in place rather than covering the transcript, so a reply streaming in behind it stays readable.
 */
export function SandboxTray({ activity, status }: SandboxTrayProps) {
  const starting = status === "starting"
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger className="group/marker flex w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-start text-xs text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-4">
        {starting ? <Spinner /> : status === "error" ? <WarningCircleIcon /> : <CubeIcon />}
        <span className={starting ? "shimmer flex-1" : "flex-1"}>
          {starting
            ? "Starting the sandbox…"
            : status === "error"
            ? "The sandbox could not be started"
            : `Sandbox · ${describeSandboxTotals(activity)}`}
        </span>
        <CaretRightIcon className="shrink-0 transition-transform group-data-[panel-open]/marker:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Tabs defaultValue="files" className="mt-2">
          <TabsList variant="line" className="w-full">
            <TabsTrigger value="files">
              <FileTextIcon />
              Files
              {activity.files.length > 0 && (
                <span className="text-muted-foreground">{activity.files.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="log">
              <TerminalWindowIcon />
              Log
              {activity.commands.length > 0 && (
                <span className="text-muted-foreground">{activity.commands.length}</span>
              )}
            </TabsTrigger>
          </TabsList>
          {
            /* Bounded and scrollable: a long file or a chatty build must not push the composer
            off the panel the host sized. */
          }
          <TabsContent value="files" className="max-h-64 overflow-y-auto">
            {activity.files.length === 0
              ? <TrayEmpty>The agent has not written any files yet.</TrayEmpty>
              : activity.files.map((file) => (
                <ToolDisclosure
                  key={file.toolCallId}
                  icon={<FileTextIcon />}
                  label={
                    <>
                      <span className="font-mono wrap-anywhere">{file.label}</span>
                      <span className="text-muted-foreground">
                        {" · "}
                        {file.lines === 1 ? "1 line" : `${file.lines} lines`}
                      </span>
                    </>
                  }
                >
                  <div className="mt-1 flex min-w-0 flex-col">
                    <SandboxCodeBlock
                      emptyLabel="Empty file"
                      caption={file.label === file.path ? undefined : file.path}
                    >
                      {file.content}
                    </SandboxCodeBlock>
                  </div>
                </ToolDisclosure>
              ))}
          </TabsContent>
          <TabsContent value="log" className="max-h-64 overflow-y-auto">
            {activity.commands.length === 0
              ? <TrayEmpty>The agent has not run any commands yet.</TrayEmpty>
              : activity.commands.map((run) => (
                <ToolDisclosure
                  key={run.toolCallId}
                  icon={<TerminalWindowIcon />}
                  running={!run.finished}
                  label={
                    <>
                      <span className="font-mono wrap-anywhere">{run.command}</span>
                      {run.finished && (
                        <span className="text-muted-foreground">
                          {" · "}
                          {describeSandboxCommandRun(run)}
                        </span>
                      )}
                    </>
                  }
                >
                  <div className="mt-1 flex min-w-0 flex-col">
                    <SandboxCommandLog run={run} />
                  </div>
                </ToolDisclosure>
              ))}
          </TabsContent>
        </Tabs>
      </CollapsibleContent>
    </Collapsible>
  )
}

function TrayEmpty({ children }: { children: string }) {
  return <p className="px-1 py-2 text-xs text-muted-foreground italic">{children}</p>
}

function describeSandboxTotals(activity: SandboxActivity): string {
  const files = activity.files.length
  const commands = activity.commands.length
  return [
    `${files} ${files === 1 ? "file" : "files"}`,
    `${commands} ${commands === 1 ? "command" : "commands"}`,
  ].join(" · ")
}
