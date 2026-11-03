import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: { target: { type: "string" }, outfile: { type: "string" } },
})
const target = (values.target ??
  `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`) as Bun.Build.CompileTarget
const nativeTarget = target.replace("bun-", "").replace("windows-", "win32-")
const required = [`sharp-${nativeTarget}`, `sharp-libvips-${nativeTarget}`]
if (
  !(await Bun.file(`.output/server/node_modules/@img/sharp-${nativeTarget}/package.json`).exists())
)
  throw new Error(
    `Missing sharp-${nativeTarget}. Install dependencies for ${target} and rebuild before compiling`,
  )

const temporary = await mkdtemp(join(tmpdir(), "astralbeam-compile-"))
try {
  const server = join(temporary, "server")
  await cp(".output/server", server, { recursive: true })
  const nativePackages = join(server, "node_modules", "@img")
  // Release builds install every target's Sharp packages. Embed only this executable's libraries.
  for (const name of new Bun.Glob("sharp-*").scanSync({ cwd: nativePackages, onlyFiles: false })) {
    if (!required.includes(name))
      await rm(join(nativePackages, name), { recursive: true, force: true })
  }
  await Bun.build({
    entrypoints: ["src/main.ts"],
    target: "bun",
    minify: true,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    compile: {
      target,
      outfile: values.outfile ?? ".output/astralbeam-platform",
      assets: [server, ".output/public", "src/db/migrations"],
      autoloadPackageJson: true,
      autoloadDotenv: true,
      autoloadBunfig: false,
    },
  })
} finally {
  await rm(temporary, { recursive: true, force: true })
}
