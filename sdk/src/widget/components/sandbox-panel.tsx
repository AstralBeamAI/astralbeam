import {
  CaretUpIcon,
  CubeIcon,
  DownloadSimpleIcon,
  FileCodeIcon,
  FileCsvIcon,
  FileTextIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react"
import { type ReactNode, useRef } from "react"
import { Button } from "@/widget/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/widget/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/widget/components/ui/tabs"
import { describeSandboxCommandRun } from "../../core/sandbox.ts"
import type { SandboxActivity, SandboxCommandRun, SandboxFileWrite } from "../../core/types.ts"
import { cn } from "cn"
import { downloadTextFile } from "../lib/utils.ts"
import { SandboxCodeBlock } from "./sandbox-code.tsx"
import { SandboxCommandLog } from "./sandbox-command-log.tsx"
import { ToolDisclosure } from "./tool-disclosure.tsx"
import { TooltipButton } from "./tooltip-button.tsx"

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
          <div className="flex min-w-0 flex-col">
            <SandboxCodeBlock
              emptyLabel="Empty file"
              caption={file.label === file.path ? undefined : file.path}
              language={file.path.split(".").at(-1)}
            >
              {file.content}
            </SandboxCodeBlock>
          </div>
        </ToolDisclosure>
      </div>
      <TooltipButton
        variant="ghost"
        size="icon-sm"
        aria-label={`Download ${file.label}`}
        tooltip="Download file"
        onClick={() => downloadTextFile(basename(file.path), file.content)}
      >
        <DownloadSimpleIcon />
      </TooltipButton>
    </div>
  )
}

function SandboxCommandRow({ run }: { run: SandboxCommandRun }) {
  const failed = run.timedOut || (run.exitCode !== undefined && run.exitCode !== 0)
  return (
    <ToolDisclosure
      icon={<TerminalWindowIcon />}
      running={!run.finished}
      failed={failed}
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
      <div className="flex min-w-0 flex-col">
        <SandboxCommandLog run={run} />
      </div>
    </ToolDisclosure>
  )
}

// Keep the sandbox above its trigger so the composer and streaming transcript do not move.
export function SandboxPanel({ activity }: { activity: SandboxActivity }) {
  const container = useRef<HTMLDivElement>(null)
  const files = activity.files.length
  const commands = activity.commands.length
  return (
    <div ref={container} className="w-full">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className="group w-full justify-start rounded-full bg-muted/50 text-xs text-muted-foreground any-pointer-coarse:min-h-11"
            />
          }
        >
          <CubeIcon />
          <span className="flex-1 text-start">
            Sandbox · {files} {files === 1 ? "file" : "files"} · {commands}{" "}
            {commands === 1 ? "command" : "commands"}
          </span>
          <CaretUpIcon className="transition-transform group-aria-expanded:rotate-180" />
        </PopoverTrigger>
        <PopoverContent
          container={container}
          side="top"
          sideOffset={8}
          aria-label="Sandbox files and command history"
          className="max-h-[min(20rem,var(--available-height))] w-(--anchor-width) max-w-(--available-width) gap-0 overflow-hidden p-0"
        >
          <Tabs defaultValue="files" className="flex min-h-0 flex-col gap-0">
            <TabsList
              variant="line"
              className="w-full shrink-0 px-2 any-pointer-coarse:h-auto any-pointer-coarse:[&_[data-slot=tabs-trigger]]:min-h-11"
            >
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
              {files === 0 ? (
                <PanelEmpty>The agent has not written any files yet.</PanelEmpty>
              ) : (
                activity.files.map((file) => <SandboxFileRow key={file.toolCallId} file={file} />)
              )}
            </TabsContent>
            <TabsContent value="log" className="min-h-0 overflow-y-auto p-2">
              {commands === 0 ? (
                <PanelEmpty>The agent has not run any commands yet.</PanelEmpty>
              ) : (
                activity.commands.map((run) => <SandboxCommandRow key={run.toolCallId} run={run} />)
              )}
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function PanelEmpty({ children }: { children: string }) {
  return <p className="px-1 py-2 text-xs text-muted-foreground italic">{children}</p>
}
