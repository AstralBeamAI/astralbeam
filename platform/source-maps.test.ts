import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { SourceMap, type SourceMapPayload } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { assert, it, onTestFinished } from "vitest"
import { build } from "vite"

import { collectSourceMaps, sourceMapDebugIds } from "./source-maps.ts"

it("registers debug IDs before a bootstrap failure without changing application UUIDs or map positions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "astralbeam-source-maps-"))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const publicDir = join(directory, ".output/public")
  await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      sourceMapDebugIds,
      {
        name: "probe",
        resolveId: () => "probe.js",
        load: () =>
          '// Original source\nglobalThis.nil = "00000000-0000-0000-0000-000000000000";\nglobalThis.failure = new Error("bootstrap failure"); throw globalThis.failure',
      },
    ],
    build: {
      outDir: publicDir,
      rolldownOptions: {
        input: "probe.js",
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
  assert.isString(payload.debugId)
  assert.deepEqual(Object.values(runtime._debugIds ?? {}), [payload.debugId])
  assert.strictEqual(runtime.nil, "00000000-0000-0000-0000-000000000000")
  assert(runtime.failure)
  const location = String(runtime.failure.stack).match(/probe\.js:(\d+):(\d+)/u)
  assert(location)
  const mapping = new SourceMap(payload).findEntry(Number(location[1]) - 1, Number(location[2]) - 1)
  assert("originalSource" in mapping)
  assert.include(mapping.originalSource, "probe.js")
  assert.strictEqual(mapping.originalLine, 2)
})

it("keeps older maps distinct after source-only edits and produces stable IDs on rebuild", async () => {
  const ids: string[] = []
  for (const source of [
    'throw new Error("failure")',
    '\n\nthrow new Error("failure")',
    'throw new Error("failure")',
  ]) {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [
        sourceMapDebugIds,
        { name: "probe", resolveId: () => "probe.js", load: () => source },
      ],
      build: { write: false, rolldownOptions: { input: "probe.js" } },
    })
    assert("output" in result)
    const chunk = result.output.find((entry) => entry.type === "chunk")!
    assert(chunk.map?.debugId)
    assert.include(chunk.code, `//# debugId=${chunk.map.debugId}`)
    const map = result.output.find((entry) => entry.fileName === chunk.sourcemapFileName)!
    assert(map.type === "asset")
    assert.strictEqual(
      (JSON.parse(String(map.source)) as { debugId: string }).debugId,
      chunk.map.debugId,
    )
    ids.push(chunk.map.debugId)
  }
  assert.notStrictEqual(ids[0], ids[1])
  assert.strictEqual(ids[0], ids[2])
})
