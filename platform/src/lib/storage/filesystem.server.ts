import { constants } from "node:fs"
import { mkdir, open, rename, rm, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { Schema } from "effect"

import { StorageUnavailable } from "./errors"
import { APP_HANDLE, APP_NAME } from "@/lib/constants"

export function defaultStorageDirectory(): string {
  const home = homedir()
  if (process.platform === "win32")
    return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), APP_NAME, "storage")
  const xdg = process.env.XDG_DATA_HOME
  if (xdg && isAbsolute(xdg)) return join(xdg, APP_HANDLE, "storage")
  return process.platform === "darwin"
    ? join(home, "Library", "Application Support", APP_NAME, "storage")
    : join(home, ".local", "share", APP_HANDLE, "storage")
}

export const StorageDirectorySchema = Schema.String.check(
  Schema.makeFilter((value) => isAbsolute(value), { message: "Use an absolute directory path" }),
)

const fileSystemKeySchema = Schema.String.check(
  Schema.isPattern(/^(?:[\w-]+\/)*[\w-]+(?:\.preview\.webp)?$/),
)

type FileSystemObject = { directory: string; key: string }

async function syncFileSystemDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return
  await using handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY)
  await handle.sync()
}

// Keys are application-generated. Local processes and the configured directory are trusted.
async function fileSystemObjectPath(input: FileSystemObject, create = false): Promise<string> {
  Schema.decodeUnknownSync(StorageDirectorySchema)(input.directory)
  Schema.decodeUnknownSync(fileSystemKeySchema)(input.key)
  const path = join(input.directory, input.key)
  if (create) await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  else if (!(await stat(input.directory).catch(() => undefined))?.isDirectory())
    throw new StorageUnavailable()
  return path
}

export async function putFileSystemObject(
  input: FileSystemObject & { bytes: Uint8Array; signal: AbortSignal },
): Promise<void> {
  const path = await fileSystemObjectPath(input, true)
  const temporary = join(dirname(path), `.${crypto.randomUUID()}.tmp`)
  try {
    {
      await using handle = await open(temporary, "wx", 0o600)
      await handle.writeFile(input.bytes, { signal: input.signal })
      await handle.sync()
    }
    input.signal.throwIfAborted()
    await rename(temporary, path)
    // Newly created directories also need durable entries in their parents.
    // https://man7.org/linux/man-pages/man2/fsync.2.html
    for (let directory = dirname(path); ; directory = dirname(directory)) {
      await syncFileSystemDirectory(directory)
      if (directory === dirname(directory)) break
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function getFileSystemObject(
  input: FileSystemObject & { maxBytes: number; signal: AbortSignal },
): Promise<Uint8Array> {
  const path = await fileSystemObjectPath(input)
  await using handle = await open(
    path,
    constants.O_RDONLY |
      (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK),
  )
  const metadata = await handle.stat()
  if (!metadata.isFile() || metadata.size > input.maxBytes) throw new StorageUnavailable()
  input.signal.throwIfAborted()
  const bytes = await handle.readFile({ signal: input.signal })
  if (bytes.length !== metadata.size) throw new StorageUnavailable()
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export async function headFileSystemObject(input: FileSystemObject) {
  const metadata = await stat(await fileSystemObjectPath(input))
  if (!metadata.isFile()) throw new StorageUnavailable()
  return { size: metadata.size, contentType: "application/octet-stream" }
}

export async function removeFileSystemObject(input: FileSystemObject): Promise<void> {
  const path = await fileSystemObjectPath(input)
  await rm(path, { force: true })
  await syncFileSystemDirectory(dirname(path)).catch(async (error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    await syncFileSystemDirectory(input.directory)
  })
}
