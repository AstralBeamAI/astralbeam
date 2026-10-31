import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"

import {
  getFileSystemObject,
  headFileSystemObject,
  putFileSystemObject,
  removeFileSystemObject,
} from "./filesystem.server"

test("bounds reads, preserves canceled writes, and handles storage outages", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "astralbeam-storage-test-"))
  const object = {
    directory: join(temporary, "storage"),
    key: "files/object",
    signal: new AbortController().signal,
  }
  const bytes = Uint8Array.of(1, 2, 3)
  try {
    await putFileSystemObject({ ...object, bytes })
    await expect(getFileSystemObject({ ...object, maxBytes: 2 })).rejects.toMatchObject({
      _tag: "StorageUnavailable",
    })
    await expect(
      putFileSystemObject({ ...object, bytes: Uint8Array.of(4), signal: AbortSignal.abort() }),
    ).rejects.toThrow()
    expect(await getFileSystemObject({ ...object, maxBytes: 3 })).toEqual(bytes)
    expect(await readdir(join(object.directory, "files"))).toEqual(["object"])
    await removeFileSystemObject(object)
    await removeFileSystemObject({ ...object, key: "absent/parent/object" })
    await expect(headFileSystemObject(object)).rejects.toMatchObject({ code: "ENOENT" })
    await rm(object.directory, { recursive: true })
    await expect(removeFileSystemObject(object)).rejects.toMatchObject({
      _tag: "StorageUnavailable",
    })
    await putFileSystemObject({ ...object, bytes })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("rejects keys that could escape the configured directory", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "astralbeam-storage-boundary-"))
  const directory = join(temporary, "storage")
  const outside = join(temporary, "outside")
  await mkdir(directory)
  await writeFile(outside, "untouched")
  try {
    for (const key of ["../outside", outside, "files\\outside"]) {
      const input = {
        directory,
        key,
        bytes: Uint8Array.of(1),
        signal: new AbortController().signal,
      }
      await expect(putFileSystemObject(input)).rejects.toThrow()
      await expect(getFileSystemObject({ ...input, maxBytes: 100 })).rejects.toThrow()
    }
    expect(await readFile(outside, "utf8")).toBe("untouched")
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
