import { spawn } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { loadEnv } from "vite"

import packageJson from "../package.json" with { type: "json" }
import { migrateDatabase } from "../src/db/migrate-command.ts"

const databaseArguments = process.argv.slice(2)
const kitCommands = ["generate", "check", "up", "export"]
if (
  databaseArguments.length === 0 ||
  (databaseArguments.length === 1 && ["--help", "-h"].includes(databaseArguments[0]!))
) {
  console.log(
    `Usage: deno task db <command>\n\nCommands: migrate [--dry-run], ${kitCommands.join(", ")}\nUse migrate to apply SQL and TypeScript together. Other commands are not supported.`,
  )
} else if (databaseArguments[0] === "migrate") {
  if (databaseArguments.slice(1).some((argument) => argument !== "--dry-run")) {
    throw new Error("Use 'deno task db migrate [--dry-run]' with DATABASE_URL from the environment")
  }
  const environment = loadEnv("development", fileURLToPath(new URL("../", import.meta.url)), "")
  for (const [name, value] of Object.entries(environment)) {
    if (process.env[name] === undefined) process.env[name] = value
  }
  const dryRun = databaseArguments.includes("--dry-run")
  const migrations = await migrateDatabase({ dryRun })
  console.log(
    migrations.length === 0
      ? "No pending migrations"
      : `${dryRun ? "Pending" : "Applied"} migrations:`,
  )
  for (const name of migrations) console.log(`  ${name}`)
} else {
  if (!kitCommands.includes(databaseArguments[0]!)) {
    throw new Error(
      `Unsupported database command '${databaseArguments[0]}'. Use 'deno task db migrate' to apply migrations. Allowed Drizzle Kit commands: ${kitCommands.join(", ")}.`,
    )
  }
  const kit = spawn(
    process.execPath,
    [
      "run",
      "--frozen",
      "-P=tooling",
      `npm:drizzle-kit@${packageJson.devDependencies["drizzle-kit"]}`,
      ...databaseArguments,
    ],
    { stdio: "inherit" },
  )
  process.exitCode = await new Promise<number>((resolve, reject) => {
    kit.once("error", reject)
    kit.once("exit", (code) => resolve(code ?? 1))
  })
}
