import { afterEach, expect, test, vi } from "vitest"
import type { AstralBeamChatCore } from "../../core/session.ts"
import type { DraftAttachment } from "./types.ts"
import {
  attachmentUploadState,
  startAttachmentUpload,
  pauseAttachmentUpload,
  resumeAttachmentUpload,
  disposeAttachmentUploads,
  releaseAttachmentUpload,
  removeAttachmentUpload,
} from "./uploads.ts"

afterEach(() => vi.unstubAllGlobals())

const session = {
  id: "upload",
  status: "pending" as const,
  filename: "note.txt",
  content_type: "text/plain",
  byte_size: 5,
  sha256: "",
  expires_at: "",
  part_size: 8 * 1024 * 1024,
  parts: [],
  file_id: null,
}
const draft: DraftAttachment = {
  id: "draft",
  name: "note.txt",
  size: 5,
  mimeType: "text/plain",
  kind: "text",
  status: "reading",
}

test("wrong-file reselection never signs parts and lets the picker try again", async () => {
  const signUploadParts = vi.fn()
  const chat = { signUploadParts } as unknown as AstralBeamChatCore
  const revokeObjectURL = vi.fn()
  vi.stubGlobal("URL", { createObjectURL: () => "blob:wrong-file", revokeObjectURL })
  const uploads = attachmentUploadState(chat)
  let state: DraftAttachment = { ...draft, kind: "image", sha256: "0".repeat(64) }
  startAttachmentUpload({
    uploads,
    draft: state,
    file: new File(["hello"], "note.txt"),
    settle: (update) => {
      state = { ...state, ...update }
    },
  })
  await vi.waitFor(() => expect(state.status).toBe("error"))
  expect(state.error).toContain("original file")
  expect(state.preview).toBeUndefined()
  expect(uploads.previews.size).toBe(0)
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:wrong-file")
  expect(signUploadParts).not.toHaveBeenCalled()
  expect(resumeAttachmentUpload({ uploads, draft: state, settle: () => {} })).toBe(false)
  disposeAttachmentUploads(uploads)
})

test("an expired part URL is replaced and progress completes only after server verification", async () => {
  const statuses = [403, 200]
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      status = 0
      upload = { onprogress: (_event: { loaded: number }) => {} }
      onload = () => {}
      onabort = () => {}
      open() {}
      abort() {
        this.onabort()
      }
      send(bytes: Blob) {
        queueMicrotask(() => {
          this.status = statuses.shift()!
          this.upload.onprogress({ loaded: bytes.size })
          this.onload()
        })
      }
    },
  )
  const signUploadParts = vi.fn(() =>
    Promise.resolve({
      parts: [{ number: 1, url: "https://storage.test/temporary-part" }],
    }),
  )
  const completeUpload = vi.fn(() =>
    Promise.resolve({
      ...session,
      status: "completed" as const,
      file_id: "accepted-file",
    }),
  )
  const chat = {
    prepareUpload: vi.fn(() => Promise.resolve(session)),
    getUpload: vi.fn(() => Promise.resolve(session)),
    signUploadParts,
    completeUpload,
  } as unknown as AstralBeamChatCore
  const uploads = attachmentUploadState(chat)
  let state = { ...draft }
  startAttachmentUpload({
    uploads,
    draft: state,
    file: new File(["hello"], "note.txt"),
    settle: (update) => {
      state = { ...state, ...update }
    },
  })
  await vi.waitFor(() => expect(state.status).toBe("ready"))
  expect(signUploadParts).toHaveBeenCalledTimes(2)
  expect(completeUpload).toHaveBeenCalledOnce()
  expect(state).toMatchObject({ sessionId: "upload", fileId: "accepted-file", progress: 1 })
  expect(state).not.toHaveProperty("data", expect.any(String))
  disposeAttachmentUploads(uploads)
})

test("upload work caps two files and four part requests, and pause releases queued work", async () => {
  const requests: { abort: () => void }[] = []
  let active = 0
  let peak = 0
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      upload = {}
      onabort = () => {}
      open() {}
      abort() {
        active -= 1
        this.onabort()
      }
      send() {
        requests.push(this)
        active += 1
        peak = Math.max(peak, active)
      }
    },
  )
  const prepareUpload = vi.fn((_input: unknown) =>
    Promise.resolve({ ...session, byte_size: 9 * 1024 * 1024 }),
  )
  const chat = {
    prepareUpload,
    getUpload: vi.fn(() => Promise.resolve({ ...session, byte_size: 9 * 1024 * 1024 })),
    signUploadParts: vi.fn((_id, parts: number[]) =>
      Promise.resolve({
        parts: parts.map((number) => ({ number, url: "https://storage.test/part" })),
      }),
    ),
  } as unknown as AstralBeamChatCore
  const uploads = attachmentUploadState(chat)
  const file = new File([new Uint8Array(9 * 1024 * 1024)], "note.txt")
  for (const id of ["first", "second", "queued"])
    startAttachmentUpload({
      uploads,
      draft: { ...draft, id, size: file.size, agentId: "origin-agent" },
      file,
      settle: () => {},
    })
  await vi.waitFor(() => expect(requests).toHaveLength(4))
  expect(prepareUpload).toHaveBeenCalledTimes(2)
  pauseAttachmentUpload({ uploads, id: "first" })
  await vi.waitFor(() => expect(prepareUpload).toHaveBeenCalledTimes(3))
  expect(peak).toBe(4)
  expect(prepareUpload.mock.calls.at(-1)?.[0]).toMatchObject({ agent_id: "origin-agent" })
  disposeAttachmentUploads(uploads)
})

test("acceptance releases only submitted browser resources without cancelling claimed storage", () => {
  const cancelUpload = vi.fn()
  const uploads = attachmentUploadState({ cancelUpload } as unknown as AstralBeamChatCore)
  const revokeObjectURL = vi.fn()
  vi.stubGlobal("URL", { revokeObjectURL })
  for (const id of ["submitted", "unsent"]) {
    uploads.files.set(id, new File(["hello"], "note.txt"))
    uploads.previews.set(id, `blob:${id}`)
  }
  releaseAttachmentUpload({ uploads, id: "submitted" })
  expect([...uploads.files.keys()]).toEqual(["unsent"])
  expect([...uploads.previews.keys()]).toEqual(["unsent"])
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:submitted")
  expect(cancelUpload).not.toHaveBeenCalled()
  disposeAttachmentUploads(uploads)
})

test.each(["expired", "cancelled", "missing", "unavailable"] as const)(
  "retry handles a %s session without losing its identity",
  async (status) => {
    const prepareUpload = vi.fn(() =>
      Promise.resolve({
        ...session,
        id: "replacement",
        status: "completed" as const,
        file_id: "new-file",
      }),
    )
    const chat = {
      getUpload: vi.fn((id) => {
        if (id === "old" && (status === "missing" || status === "unavailable"))
          return Promise.reject(
            Object.assign(new Error("Upload unavailable"), {
              name: "AstralBeamApiError",
              status: status === "missing" ? 404 : 503,
            }),
          )
        return Promise.resolve(
          id === "old"
            ? { ...session, status }
            : { ...session, status: "completed", file_id: "new-file" },
        )
      }),
      prepareUpload,
      completeUpload: vi.fn(() =>
        Promise.resolve({ ...session, status: "completed", file_id: "new-file" }),
      ),
    } as unknown as AstralBeamChatCore
    const uploads = attachmentUploadState(chat)
    let state: DraftAttachment = { ...draft, sessionId: "old" }
    startAttachmentUpload({
      uploads,
      draft: state,
      file: new File(["hello"], "note.txt"),
      settle: (update) => {
        state = { ...state, ...update }
      },
    })
    await vi.waitFor(() => expect(state.status).toBe(status === "unavailable" ? "error" : "ready"))
    expect(prepareUpload).toHaveBeenCalledTimes(status === "unavailable" ? 0 : 1)
    expect(state.sessionId).toBe(status === "unavailable" ? "old" : "replacement")
    disposeAttachmentUploads(uploads)
  },
)

test("removal retains a failed cancellation for retry and releases browser resources", async () => {
  const cancelUpload = vi
    .fn()
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue(undefined)
  const uploads = attachmentUploadState({ cancelUpload } as unknown as AstralBeamChatCore)
  uploads.files.set(draft.id, new File(["hello"], "note.txt"))
  const controller = new AbortController()
  uploads.tasks.set(draft.id, controller)
  const pending = { ...draft, sessionId: "pending", status: "paused" as const }
  await expect(removeAttachmentUpload({ uploads, draft: pending })).rejects.toThrow("Unavailable")
  expect(controller.signal.aborted).toBe(true)
  expect(uploads.files.size).toBe(0)
  expect(cancelUpload).toHaveBeenCalledExactlyOnceWith("pending")
  await removeAttachmentUpload({ uploads, draft: pending })
  expect(cancelUpload).toHaveBeenCalledTimes(2)
  disposeAttachmentUploads(uploads)
})
