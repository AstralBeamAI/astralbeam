import { $ } from "bun"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import packageJson from "../../package.json" with { type: "json" }

if (`bun@${Bun.version}` !== packageJson.packageManager)
  throw new Error(`Generation requires ${packageJson.packageManager}.`)

const devDependencies = {
  "@bytecodealliance/jco": "1.39.0",
  "@cloudflare/cf-source":
    "https://codeload.github.com/cloudflare/cf/tar.gz/edc13dfabe31e03fe22eab2def89d716d346ebf0",
  "@cloudflare/forge":
    "https://pkg.pr.new/cloudflare/forge/@cloudflare/forge@260488a28036586904e9a020dea46a9bcdcea553",
}
const root = join(import.meta.dir, "../..")
const generated = join(root, "src/generated")

// File transfer and raw chat execution stay outside the generated management CLI.
const excludedOperations = new Set(["uploadChatFile", "getThreadAttachment", "runChat"])

interface Operation {
  operationId: string
  security?: Record<string, string[]>[]
  description?: string
  summary?: string
  parameters?: { in: string; name: string; "x-fern-parameter-name"?: string }[]
  [key: string]: unknown
}
const spec = (await Bun.file(join(root, "../platform/public/api/openapi.json")).json()) as {
  paths: Record<string, Record<string, Operation>>
  security?: Record<string, string[]>[]
}
spec.paths = Object.fromEntries(
  Object.entries(spec.paths).flatMap(([path, methods]) => {
    const selected = Object.fromEntries(
      Object.entries(methods).filter(
        ([, op]) =>
          !excludedOperations.has(op.operationId) &&
          (op.security ?? spec.security ?? []).some(
            (security) =>
              Object.hasOwn(security, "OrganizationApiKey") && Object.keys(security).length === 1,
          ),
      ),
    )
    for (const op of Object.values(selected)) {
      const verb = op.operationId
        .split(".")
        .at(-1)!
        .replace(/[A-Z].*$/, "")
      const groups = path
        .replace(/^\/api\/v1\//, "")
        .split("/")
        .filter((part) => !part.startsWith("{"))
      if (groups[0] === "tenants" && groups[1] === "tenant_users") groups.shift()
      if (groups.at(-1) === verb) groups.pop()
      op["x-fern-sdk-group-name"] = groups.map((part) => part.replaceAll("_", "-"))
      op["x-fern-sdk-method-name"] = verb
      op.description ??= op.summary ?? op.operationId
      // Alias until bracketed names are supported. The transport restores filter[...] query names.
      // https://github.com/cloudflare/cf/blob/edc13dfabe31e03fe22eab2def89d716d346ebf0/packages/cli/generator/plugin/args.ts#L626-L628
      for (const parameter of op.parameters ?? []) {
        const filter = parameter.in === "query" && /^filter\[(.+)\]$/.exec(parameter.name)?.[1]
        if (filter) {
          parameter.name = `filter_${filter}`
          parameter["x-fern-parameter-name"] = filter
        }
      }
    }
    return Object.keys(selected).length ? [[path, selected]] : []
  }),
)
const temporary = await mkdtemp(join(tmpdir(), "astralbeam-forge-"))
try {
  await writeFile(join(temporary, "package.json"), JSON.stringify({ devDependencies }))
  await writeFile(join(temporary, "bunfig.toml"), "env = false\n")
  await writeFile(
    join(temporary, "plugin.mjs"),
    `
import { cliPlugin } from "@cloudflare/cf-source/packages/cli/generator/plugin/index.ts"
export const { generate, generateGroup } = cliPlugin({
  handWritten: [],
  sidecars: { roots: {}, subgroups: {}, leaves: {}, leafOverrides: {} },
})
`,
  )
  const run = $.cwd(temporary)
  await run`bun install --ignore-scripts`
  await run`bun run --bun forge-plugin build plugin.mjs -o cli.wasm`
  await writeFile(join(temporary, "openapi.json"), JSON.stringify(spec))
  const output = join(temporary, "generated")
  await run`bun run --bun forge openapi.json --target ${`wasm://${join(temporary, "cli.wasm")}`} --out ${output}`
  // Cloudflare-specific roots and metadata are not registered in AstralBeam.
  for (const name of ["access", "_meta"])
    await rm(join(output, name), { recursive: true, force: true })
  const roots = (await Array.fromAsync(new Bun.Glob("*/index.ts").scan(output))).sort()
  await writeFile(
    join(output, "index.ts"),
    roots
      .map(
        (path, index) =>
          `export { default as command${index} } from "./${path.replace(/\.ts$/, ".js")}"`,
      )
      .join("\n"),
  )
  const upstream = join(temporary, "node_modules/@cloudflare/cf-source/packages/cli")
  await mkdir(join(output, "_runtime"))
  for (const [from, name] of [
    ["lib/body-parser.ts", "body-parser.ts"],
    ["lib/input-validation.ts", "input-validation.ts"],
    ["lib/cli-types.ts", "cli-types.ts"],
    ["api/path.ts", "path.ts"],
  ] as const)
    await cp(join(upstream, "src", from), join(output, "_runtime", name))
  await rm(generated, { recursive: true, force: true })
  await cp(output, generated, { recursive: true })
} finally {
  await rm(temporary, { recursive: true, force: true })
}
