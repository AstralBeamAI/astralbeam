import type { Cli } from "./options.ts"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { stderr, stdout } from "node:process"
import { fileURLToPath } from "node:url"
import { runState } from "./config.ts"
import { printResult } from "./output.ts"

// Bun embeds assets beside the executable entry. https://bun.sh/docs/bundler/executables
const SKILL_URL = new URL(
  typeof Bun !== "undefined" && Bun.isStandaloneExecutable
    ? "./skills/astralbeam/SKILL.md"
    : "../skills/astralbeam/SKILL.md",
  import.meta.url,
)

export function registerSkillCommands(skill: Cli): Cli {
  skill.command({
    command: "$0",
    describe: false,
    handler: async () => {
      const content = await readFile(fileURLToPath(SKILL_URL), "utf8")
      if (runState.json) printResult({ content }, true)
      else stdout.write(content)
    },
  })

  skill.command(
    "install",
    "Write the skill to <dir>/astralbeam/SKILL.md",
    (y) =>
      y.option("dir", {
        type: "string",
        default: ".claude/skills",
        description: "skills directory, such as ~/.claude/skills or .agents/skills",
      }),
    async (options) => {
      const directory = resolve(options.dir, "astralbeam")
      await mkdir(directory, { recursive: true })
      const path = join(directory, "SKILL.md")
      await writeFile(path, await readFile(fileURLToPath(SKILL_URL), "utf8"))
      if (!runState.json) stderr.write("Restart your agent session to load the skill.\n")
      printResult({ path }, runState.json)
    },
  )
  return skill
}
