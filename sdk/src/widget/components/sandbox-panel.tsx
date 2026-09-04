import {
  CaretUpIcon,
  CubeIcon,
  DownloadSimpleIcon,
  FileCodeIcon,
  FileCsvIcon,
  FileTextIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react"
import { type ReactNode, useState } from "react"
import { Button } from "@/widget/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/widget/components/ui/tabs"
import { describeSandboxCommandRun } from "../../core/sandbox.ts"
import type { SandboxActivity, SandboxCommandRun, SandboxFileWrite } from "../../core/types.ts"
import { cn } from "cn"
import { downloadTextFile } from "../lib/utils.ts"
import { SandboxCodeBlock } from "./sandbox-code.tsx"
import { SandboxCommandLog } from "./sandbox-command-log.tsx"
import { ToolDisclosure } from "./tool-disclosure.tsx"

const CODE_EXTENSIONS = new Set([
  "c",
  "cpp",
  "css",
  "go",
  "html",
  "js",
  "json",
  "jsx",
  "mjs",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "yaml",
  "yml",
])

function fileKindIcon(path: string): ReactNode {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
  if (CODE_EXTENSIONS.has(extension)) return <FileCodeIcon />
  if (extension === "csv" || extension === "tsv") return <FileCsvIcon />
  return <FileTextIcon />
}

function basename(path: string): string {
  const index = path.lastIndexOf("/")
  return index === -1 ? path : path.slice(index + 1)
}

function SandboxFileRow({ file }: { file: SandboxFileWrite }) {
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <ToolDisclosure
          icon={fileKindIcon(file.path)}
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
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Download ${file.label}`}
        title="Download"
        onClick={() => downloadTextFile(basename(file.path), file.content)}
      >
        <DownloadSimpleIcon />
      </Button>
    </div>
  )
}

function SandboxCommandRow({ run }: { run: SandboxCommandRun }) {
  const failed = run.timedOut || (run.exitCode !== undefined && run.exitCode !== 0)
  return (
    <ToolDisclosure
      icon={<TerminalWindowIcon />}
      running={!run.finished}
      label={
        <>
          <span className="font-mono wrap-anywhere">{run.command}</span>
          {run.finished && (
            <span className={cn("ms-1", failed ? "text-destructive" : "text-muted-foreground")}>
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
  )
}

/**
 * Opt-in overview of the conversation's sandbox (`sandboxPanel: true`): what is in it now, and
 * what every command printed. The panel opens above the trigger as an anchored sheet instead of
 * expanding in place, so the composer never moves and a streaming reply stays readable.
 */
export function SandboxPanel({ activity }: { activity: SandboxActivity }) {
  const [open, setOpen] = useState(false)
  const files = activity.files.length
  const commands = activity.commands.length
  return (
    <div className="relative w-full">
      {open && (
        <div className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-80 flex-col overflow-hidden rounded-lg border bg-background shadow-lg">
          <Tabs defaultValue="files" className="flex min-h-0 flex-col gap-0">
            <TabsList variant="line" className="w-full shrink-0 px-2">
              <TabsTrigger value="files">
                <FileTextIcon />
                Files
                {files > 0 && <span className="text-muted-foreground">{files}</span>}
              </TabsTrigger>
              <TabsTrigger value="log">
                <TerminalWindowIcon />
                Log
                {commands > 0 && <span className="text-muted-foreground">{commands}</span>}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="files" className="min-h-0 overflow-y-auto p-2">
              {files === 0
                ? <PanelEmpty>The agent has not written any files yet.</PanelEmpty>
                : activity.files.map((file) => (
                  <SandboxFileRow key={file.toolCallId} file={file} />
                ))}
            </TabsContent>
            <TabsContent value="log" className="min-h-0 overflow-y-auto p-2">
              {commands === 0
                ? <PanelEmpty>The agent has not run any commands yet.</PanelEmpty>
                : activity.commands.map((run) => (
                  <SandboxCommandRow key={run.toolCallId} run={run} />
                ))}
            </TabsContent>
          </Tabs>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-full border bg-muted/50 px-3 py-1.5 text-start text-xs text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-4"
      >
        <CubeIcon />
        <span className="flex-1">
          Sandbox · {files} {files === 1 ? "file" : "files"} · {commands}{" "}
          {commands === 1 ? "command" : "commands"}
        </span>
        <CaretUpIcon className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>
    </div>
  )
}

function PanelEmpty({ children }: { children: string }) {
  return <p className="px-1 py-2 text-xs text-muted-foreground italic">{children}</p>
}
