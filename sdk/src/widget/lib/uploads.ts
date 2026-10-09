import { isAstralBeamApiError } from "../../api/api.ts"
import type { AstralBeamChatCore } from "../../core/session.ts"
import type { ChatAuthenticationState } from "../../core/auth.ts"
import type { DraftAttachment } from "./types.ts"
import { storedThreadAttachments } from "./drafts.ts"

interface UploadSlots {
  active: number
  limit: number
  waiting: (() => void)[]
}
interface UploadTask {
  controller: AbortController
  prepareAttempted: boolean
  preparation?: Promise<void> | undefined
}

async function withUploadSlot<T>(
  slots: UploadSlots,
  work: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (slots.active >= slots.limit) await new Promise<void>((resolve) => slots.waiting.push(resolve))
  else slots.active += 1
  try {
    signal.throwIfAborted()
    return await work()
  } finally {
    const next = slots.waiting.shift()
    if (next) next()
    else slots.active -= 1
  }
}

function putPart(url: string, bytes: Blob, signal: AbortSignal, progress: (bytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const request = new XMLHttpRequest()
    const abort = () => request.abort()
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort)
      if (error) reject(error)
      else resolve()
    }
    request.open("PUT", url)
    request.timeout = 5 * 60_000
    request.upload.onprogress = (event) => progress(event.loaded)
    request.onload = () =>
      finish(
        request.status >= 200 && request.status < 300 ? undefined : new Error("Part upload failed"),
      )
    request.onerror = () => finish(new Error("Part upload failed"))
    request.ontimeout = () => finish(new Error("Part upload timed out"))
    request.onabort = () => finish(new DOMException("Upload paused", "AbortError"))
    signal.addEventListener("abort", abort, { once: true })
    request.send(bytes)
  })
}

async function fingerprint(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Signed URLs and File objects exist only in memory. */
export function attachmentUploadState(chat: AstralBeamChatCore) {
  return {
    chat,
    files: new Map<string, File>(),
    tasks: new Map<string, UploadTask>(),
    previews: new Map<string, string>(),
    fileSlots: { active: 0, limit: 2, waiting: [] } as UploadSlots,
    partSlots: { active: 0, limit: 4, waiting: [] } as UploadSlots,
  }
}
type AttachmentUploads = ReturnType<typeof attachmentUploadState>
type Settle = (update: Partial<DraftAttachment>) => void

function checkUploadAuthentication(uploads: AttachmentUploads, auth: ChatAuthenticationState) {
  if (uploads.chat.getState().auth !== auth)
    throw new DOMException("Authentication changed", "AbortError")
}

export function attachmentUploadPreview({
  uploads,
  id,
  blob,
}: {
  uploads: AttachmentUploads
  id: string
  blob: Blob
}) {
  const old = uploads.previews.get(id)
  if (old) URL.revokeObjectURL(old)
  const url = URL.createObjectURL(blob)
  uploads.previews.set(id, url)
  return url
}

export function pauseAttachmentUpload({ uploads, id }: { uploads: AttachmentUploads; id: string }) {
  uploads.tasks.get(id)?.controller.abort()
}

export async function getAttachmentUpload({
  chat,
  id,
  signal,
}: {
  chat: AstralBeamChatCore
  id: string
  signal?: AbortSignal
}) {
  try {
    return await chat.getUpload(id, signal)
  } catch (error) {
    if (isAstralBeamApiError(error) && error.status === 404) return undefined
    throw error
  }
}

async function uploadParts({
  uploads,
  sessionId,
  file,
  signal,
  progress,
}: {
  uploads: AttachmentUploads
  sessionId: string
  file: File
  signal: AbortSignal
  progress: (fraction: number) => void
}) {
  const { chat } = uploads
  let session = await chat.getUpload(sessionId, signal)
  for (let attempt = 0; session.status === "preparing" && attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    signal.throwIfAborted()
    session = await chat.getUpload(sessionId, signal)
  }
  if (session.status === "preparing") throw new Error("Upload is still preparing. Retry to resume.")
  if (session.status === "completed" || session.status === "completing") return
  if (session.status !== "pending")
    throw new Error("Upload expired. Remove it and attach the file again.")
  const sizes = new Map(session.parts.map((part) => [part.number, part.size]))
  const count = Math.ceil(file.size / session.part_size)
  const update = () =>
    progress([...sizes.values()].reduce((sum, bytes) => sum + bytes, 0) / file.size)
  update()
  await Promise.all(
    Array.from({ length: count }, (_, index) => index + 1).map((number) =>
      withUploadSlot(
        uploads.partSlots,
        async () => {
          const start = (number - 1) * session.part_size
          const bytes = file.slice(start, Math.min(start + session.part_size, file.size))
          if (sizes.get(number) === bytes.size) return
          for (let attempt = 0; attempt < 3; attempt += 1) {
            signal.throwIfAborted()
            const signed = await chat.signUploadParts(sessionId, [number], signal)
            try {
              await putPart(signed.parts[0]!.url, bytes, signal, (loaded) => {
                sizes.set(number, loaded)
                update()
              })
              sizes.set(number, bytes.size)
              update()
              return
            } catch (error) {
              signal.throwIfAborted()
              sizes.set(number, 0)
              update()
              if (attempt === 2) throw error
            }
          }
        },
        signal,
      ),
    ),
  )
}

export function startAttachmentUpload({
  uploads,
  draft,
  file,
  settle,
  persist,
}: {
  uploads: AttachmentUploads
  draft: DraftAttachment
  file: File
  settle: Settle
  persist: (draft: DraftAttachment) => Promise<void>
}) {
  const { chat, files, tasks } = uploads
  const previous = tasks.get(draft.id)
  const prepareAttempted =
    !!draft.sessionId || !!previous?.prepareAttempted || (draft.prepareAttempted ?? !!draft.sha256)
  pauseAttachmentUpload({ uploads, id: draft.id })
  files.set(draft.id, file)
  const controller = new AbortController()
  const signal = controller.signal
  const task: UploadTask = {
    controller,
    prepareAttempted,
    preparation: previous?.preparation?.catch(() => undefined),
  }
  tasks.set(draft.id, task)
  settle({
    status: "uploading",
    error: undefined,
    ...(draft.kind === "image"
      ? { preview: attachmentUploadPreview({ uploads, id: draft.id, blob: file }) }
      : {}),
  })
  void withUploadSlot(
    uploads.fileSlots,
    async () => {
      await task.preparation
      signal.throwIfAborted()
      const sha256 = await fingerprint(file)
      signal.throwIfAborted()
      if (
        draft.size !== file.size ||
        draft.name !== file.name ||
        (draft.sha256 && draft.sha256 !== sha256)
      ) {
        files.delete(draft.id)
        const preview = uploads.previews.get(draft.id)
        if (preview) URL.revokeObjectURL(preview)
        uploads.previews.delete(draft.id)
        settle({ preview: undefined })
        throw new Error("Choose the original file to resume this upload.")
      }
      const saved = draft.sessionId
        ? await getAttachmentUpload({ chat, id: draft.sessionId, signal })
        : undefined
      if (draft.sessionId && (!saved || saved.status === "expired" || saved.status === "cancelled"))
        throw new Error("Upload expired or unavailable. Remove it and attach the file again.")
      if (!saved && !draft.agentId)
        throw new Error("The original agent is unavailable. Remove it and attach the file again.")
      if (!saved || saved.status === "preparing") {
        task.preparation = (async () => {
          await persist({ ...draft, prepareAttempted: true, sha256 })
          if (signal.aborted && !task.prepareAttempted)
            await persist({ ...draft, prepareAttempted: false, sha256 })
        })()
        await task.preparation
        signal.throwIfAborted()
        task.prepareAttempted = true
        settle({ prepareAttempted: true, sha256 })
      }
      const session =
        saved && saved.status !== "preparing"
          ? saved
          : await chat.prepareUpload(
              {
                prepare_key: draft.id,
                filename: draft.name,
                content_type: draft.mimeType,
                byte_size: file.size,
                sha256,
                ...(draft.agentId ? { agent_id: draft.agentId } : {}),
              },
              signal,
            )
      settle({ sessionId: session.id, sha256 })
      await uploadParts({
        uploads,
        sessionId: session.id,
        file,
        signal,
        progress: (progress) => {
          if (!signal.aborted) settle({ progress })
        },
      })
      const finished = await chat.completeUpload(session.id, signal)
      signal.throwIfAborted()
      if (!finished.file_id || finished.status !== "completed")
        throw new Error("Upload did not complete")
      settle({ status: "ready", fileId: finished.file_id, progress: 1, data: undefined })
    },
    signal,
  )
    .catch((error: unknown) => {
      if (tasks.get(draft.id) !== task) return
      const paused = signal.aborted
      controller.abort()
      settle(
        paused
          ? { status: "paused" }
          : {
              status: "error",
              error: error instanceof Error ? error.message : "Upload failed. Retry to resume.",
            },
      )
    })
    .finally(() => {
      if (tasks.get(draft.id) === task && !task.prepareAttempted) tasks.delete(draft.id)
    })
}
export function resumeAttachmentUpload({
  uploads,
  draft,
  settle,
  persist,
}: {
  uploads: AttachmentUploads
  draft: DraftAttachment
  settle: Settle
  persist: (draft: DraftAttachment) => Promise<void>
}) {
  const file = uploads.files.get(draft.id)
  if (file) startAttachmentUpload({ uploads, draft, file, settle, persist })
  return !!file
}

export function releaseAttachmentUpload({
  uploads,
  id,
}: {
  uploads: AttachmentUploads
  id: string
}) {
  pauseAttachmentUpload({ uploads, id })
  uploads.tasks.delete(id)
  uploads.files.delete(id)
  const url = uploads.previews.get(id)
  if (url) URL.revokeObjectURL(url)
  uploads.previews.delete(id)
}

export async function removeAttachmentUpload({
  uploads,
  draft,
  auth = uploads.chat.getState().auth,
}: {
  uploads: AttachmentUploads
  draft: DraftAttachment
  auth?: ChatAuthenticationState
}) {
  checkUploadAuthentication(uploads, auth)
  const task = uploads.tasks.get(draft.id)
  releaseAttachmentUpload({ uploads, id: draft.id })
  await task?.preparation?.catch(() => undefined)
  checkUploadAuthentication(uploads, auth)
  const attempted = task?.prepareAttempted ?? draft.prepareAttempted ?? !!draft.sha256
  if (!draft.sessionId && !attempted) return
  await (
    draft.sessionId
      ? uploads.chat.cancelUpload(draft.sessionId)
      : uploads.chat.cancelPreparedUpload(draft.id)
  ).catch((error: unknown) => {
    if (isAstralBeamApiError(error) && error.status === 404) return
    if (task?.prepareAttempted && !uploads.tasks.has(draft.id)) uploads.tasks.set(draft.id, task)
    throw error
  })
  checkUploadAuthentication(uploads, auth)
}

export async function discardAttachmentUploads({
  uploads,
  apiUrl,
  identity,
  threadId,
  attachments,
  auth,
}: {
  uploads: AttachmentUploads
  apiUrl: string
  identity: string
  threadId: string
  attachments: readonly DraftAttachment[]
  auth: ChatAuthenticationState
}) {
  checkUploadAuthentication(uploads, auth)
  const persisted = await storedThreadAttachments({ apiUrl, identity, threadId })
  const files = new Map(persisted.map((file) => [file.id, file]))
  for (const file of attachments)
    files.set(file.id, {
      ...file,
      prepareAttempted:
        (file.prepareAttempted || files.get(file.id)?.prepareAttempted) ?? file.prepareAttempted,
    })
  await Promise.all(
    [...files.values()].map(async (file) => {
      checkUploadAuthentication(uploads, auth)
      const task = uploads.tasks.get(file.id)
      releaseAttachmentUpload({ uploads, id: file.id })
      await task?.preparation?.catch(() => undefined)
      checkUploadAuthentication(uploads, auth)
      const attempted = task?.prepareAttempted ?? file.prepareAttempted ?? !!file.sha256
      if (!file.sessionId && !attempted) return
      await (
        file.sessionId
          ? uploads.chat.cancelUpload(file.sessionId)
          : uploads.chat.cancelPreparedUpload(file.id)
      ).catch((error: unknown) => {
        if (
          isAstralBeamApiError(error) &&
          (error.status === 404 ||
            (error.status === 409 && error.body?.type === "urn:file-upload:claimed"))
        )
          return
        throw error
      })
    }),
  )
  await storedThreadAttachments({
    apiUrl,
    identity,
    threadId,
    update: (current) => {
      checkUploadAuthentication(uploads, auth)
      return current.filter((file) => !files.has(file.id))
    },
  })
}

export function disposeAttachmentUploads(uploads: AttachmentUploads) {
  for (const task of uploads.tasks.values()) task.controller.abort()
  uploads.tasks.clear()
  uploads.files.clear()
  for (const url of uploads.previews.values()) URL.revokeObjectURL(url)
  uploads.previews.clear()
}
