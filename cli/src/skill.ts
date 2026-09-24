import type { Command } from "commander"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { stderr, stdout } from "node:process"
import { fileURLToPath } from "node:url"
import { globalOptions } from "./config.ts"
import { printResult } from "./output.ts"

// Resolves from both src/ and dist/, and inside `deno compile --include skills` binaries.
const SKILL_URL = new URL("../skills/astralbeam/SKILL.md", import.meta.url)

export function registerSkillCommands(program: Command): void {
  const skill = program
    .command("skill")
    .description("Print or install the Agent Skill that teaches coding agents this CLI")
    .action(async () => {
      stdout.write(await readFile(fileURLToPath(SKILL_URL), "utf8"))
    })

  skill
    .command("install")
    .description("Write the skill to <dir>/astralbeam/SKILL.md")
    .option(
      "--dir <path>",
      "skills directory, such as ~/.claude/skills or .agents/skills",
      ".claude/skills",
    )
    .action(async (options: { dir: string }, command: Command) => {
      const directory = resolve(options.dir, "astralbeam")
      await mkdir(directory, { recursive: true })
      const path = join(directory, "SKILL.md")
      await writeFile(path, await readFile(fileURLToPath(SKILL_URL), "utf8"))
      const { json } = globalOptions(command)
      if (!json) stderr.write("Restart your agent session to load the skill.\n")
      printResult({ path }, json)
    })
}
