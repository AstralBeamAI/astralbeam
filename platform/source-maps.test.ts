import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { SourceMap, type SourceMapPayload } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { assert, it, onTestFinished } from "vitest"
import { build } from "vite"

import { collectSourceMaps, sourceMapDebugIds } from "./source-maps.ts"

it("chains SSR maps, registers bootstrap failures, and keeps distinct revisions reproducible", async () => {
  const directory = mkdtempSync(join(tmpdir(), "astralbeam-source-maps-"))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const intermediate = join(directory, ".nitro/vite/services/ssr")
  const publicDir = join(directory, ".output/public")
  const ids: string[] = []
  for (const [padding, originalLine] of [
    ["", 2],
    ["\n\n", 4],
    ["", 2],
  ] as const) {
    await build({
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "probe",
          resolveId: () => "original.ts",
          load: () =>
            `${padding}// Original source\nglobalThis.nil = "00000000-0000-0000-0000-000000000000";\nglobalThis.failure = new Error("bootstrap failure"); throw globalThis.failure`,
        },
      ],
      build: {
        sourcemap: true,
        outDir: intermediate,
        rolldownOptions: { input: "original.ts", output: { entryFileNames: "probe.js" } },
      },
    })
    await build({
      configFile: false,
      logLevel: "silent",
      plugins: [sourceMapDebugIds],
      build: {
        outDir: publicDir,
        rolldownOptions: {
          input: join(intermediate, "probe.js"),
          output: { format: "iife", entryFileNames: "probe.js" },
        },
      },
    })
    const code = readFileSync(join(publicDir, "probe.js"), "utf8")
    const map = readFileSync(join(publicDir, "probe.js.map"), "utf8")
    const payload = JSON.parse(map) as SourceMapPayload & { debugId: string }
    collectSourceMaps(publicDir)
    const archived = join(directory, ".output/sourcemaps/public/probe.js")
    assert.strictEqual(readFileSync(archived, "utf8"), code)
    assert.strictEqual(readFileSync(`${archived}.map`, "utf8"), map)
    assert.strictEqual(readFileSync(join(publicDir, "probe.js"), "utf8"), code)
    assert.isFalse(existsSync(join(publicDir, "probe.js.map")))
    const runtime: { _debugIds?: Record<string, string>; nil?: string; failure?: Error } = {}
    assert.throws(() => {
      runInNewContext(code, runtime, { filename: "probe.js" })
    })
    assert.deepEqual(Object.values(runtime._debugIds ?? {}), [payload.debugId])
    assert.include(code, `//# debugId=${payload.debugId}`)
    assert.strictEqual(runtime.nil, "00000000-0000-0000-0000-000000000000")
    assert(runtime.failure)
    const location = String(runtime.failure.stack).match(/probe\.js:(\d+):(\d+)/u)
    assert(location)
    const mapping = new SourceMap(payload).findEntry(
      Number(location[1]) - 1,
      Number(location[2]) - 1,
    )
    assert("originalSource" in mapping)
    assert.include(mapping.originalSource, "original.ts")
    assert.strictEqual(mapping.originalLine, originalLine)
    ids.push(payload.debugId)
  }
  assert.notStrictEqual(ids[0], ids[1])
  assert.strictEqual(ids[0], ids[2])
})
