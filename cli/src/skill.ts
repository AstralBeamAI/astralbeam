import type { Command } from "commander"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { stderr, stdout } from "node:process"
import { globalOptions } from "./config.ts"
import { printResult } from "./output.ts"

const SKILL_URL = new URL("../../skills/astralbeam/SKILL.md", import.meta.url)

export function registerSkillCommands(program: Command): void {
  const skill = program
    .command("skill")
    .description("Print or install the AstralBeam integration skill")
    .action(async (_options: object, command: Command) => {
      const content = await readFile(SKILL_URL, "utf8")
      if (globalOptions(command).json) printResult({ content }, true)
      else stdout.write(content)
    })

  skill
    .command("install")
    .description("Write the skill to <dir>/astralbeam/SKILL.md")
    .option(
      "--dir <path>",
      "skills directory relative to the current directory, or an absolute path",
      ".agents/skills",
    )
    .action(async (options: { dir: string }, command: Command) => {
      const directory = resolve(options.dir, "astralbeam")
      await mkdir(directory, { recursive: true })
      const path = join(directory, "SKILL.md")
      await writeFile(path, await readFile(SKILL_URL, "utf8"))
      const { json } = globalOptions(command)
      if (!json) stderr.write("Restart your agent session to load the skill.\n")
      printResult({ path }, json)
    })
}
