import { afterEach, expect, test, vi } from "vitest"
import { createAstralBeamChat, type AstralBeamChatCore } from "../../core/session.ts"
import type { DraftAttachment } from "./types.ts"
import { storedThreadAttachments } from "./drafts.ts"
import { readAttachmentData } from "./attachments.ts"
import {
  attachmentUploadState,
  startAttachmentUpload,
  pauseAttachmentUpload,
  resumeAttachmentUpload,
  disposeAttachmentUploads,
  releaseAttachmentUpload,
  removeAttachmentUpload,
  discardAttachmentUploads,
  recoverAttachmentUpload,
} from "./uploads.ts"

vi.mock("./drafts.ts", () => ({ storedThreadAttachments: vi.fn(() => Promise.resolve([])) }))
vi.mock("./attachments.ts", () => ({
  readAttachmentData: vi.fn(() => Promise.resolve("aGVsbG8=")),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(storedThreadAttachments).mockReset().mockResolvedValue([])
  vi.mocked(readAttachmentData).mockClear()
})

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
  prepareAttempted: false,
  agentId: "origin-agent",
}
const persist = async () => {}
const captureAuthentication = () => () => true

test.each([undefined, 503, 403, 404, "expired", "cancelled"] as const)(
  "completed attachment recovery preserves only transient failures: %s",
  async (status) => {
    const chat = {
      getUpload: () =>
        typeof status === "string"
          ? Promise.resolve({ ...session, status })
          : Promise.reject(
              Object.assign(
                new Error("Unavailable"),
                status ? { name: "AstralBeamApiError", status } : {},
              ),
            ),
    } as unknown as AstralBeamChatCore
    const ready = { ...draft, status: "ready" as const, sessionId: "upload", fileId: "verified" }
    const recovered = await recoverAttachmentUpload({ chat, draft: ready })
    const transient = status === undefined || status === 503
    expect(recovered.status).toBe(transient ? "ready" : "reselect")
    expect(recovered.fileId).toBe(transient ? "verified" : undefined)
    const unfinished = await recoverAttachmentUpload({
      chat,
      draft: { ...draft, sessionId: "upload" },
    })
    expect(unfinished.status).toBe("reselect")
    expect(unfinished.fileId).toBeUndefined()
  },
)

test("wrong-file reselection never signs parts and lets the picker try again", async () => {
  const signUploadParts = vi.fn()
  const chat = { signUploadParts, captureAuthentication } as unknown as AstralBeamChatCore
  const revokeObjectURL = vi.fn()
  vi.stubGlobal("URL", { createObjectURL: () => "blob:wrong-file", revokeObjectURL })
  const uploads = attachmentUploadState(chat)
  let state: DraftAttachment = { ...draft, kind: "image", sha256: "0".repeat(64) }
  startAttachmentUpload({
    uploads,
    draft: state,
    file: new File(["hello"], "note.txt"),
    persist,
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
  expect(resumeAttachmentUpload({ uploads, draft: state, settle: () => {}, persist })).toBe(false)
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
    captureAuthentication,
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
    persist,
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
    captureAuthentication,
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
      persist,
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
  "retry retains a %s session and requires removal before preparing again",
  async (status) => {
    const prepareUpload = vi.fn()
    const chat = {
      captureAuthentication,
      getUpload: vi.fn(() => {
        if (status === "missing" || status === "unavailable")
          return Promise.reject(
            Object.assign(new Error("Upload unavailable"), {
              name: "AstralBeamApiError",
              status: status === "missing" ? 404 : 503,
            }),
          )
        return Promise.resolve({ ...session, status })
      }),
      prepareUpload,
    } as unknown as AstralBeamChatCore
    const uploads = attachmentUploadState(chat)
    let state: DraftAttachment = { ...draft, sessionId: "old" }
    startAttachmentUpload({
      uploads,
      draft: state,
      file: new File(["hello"], "note.txt"),
      persist,
      settle: (update) => {
        state = { ...state, ...update }
      },
    })
    await vi.waitFor(() => expect(state.status).toBe("error"))
    expect(prepareUpload).not.toHaveBeenCalled()
    expect(state.sessionId).toBe("old")
    disposeAttachmentUploads(uploads)
  },
)

test.each([true, false])(
  "removal retains a failed cancellation for retry with a known session: %s",
  async (known) => {
    const cancelUpload = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue(undefined)
    const uploads = attachmentUploadState({
      cancelUpload,
      cancelPreparedUpload: cancelUpload,
      captureAuthentication,
    } as unknown as AstralBeamChatCore)
    uploads.files.set(draft.id, new File(["hello"], "note.txt"))
    const controller = new AbortController()
    uploads.tasks.set(draft.id, { controller, prepareAttempted: !known })
    const pending = {
      ...draft,
      ...(known ? { sessionId: "pending" } : {}),
      status: "paused" as const,
    }
    await expect(removeAttachmentUpload({ uploads, draft: pending })).rejects.toThrow("Unavailable")
    expect(controller.signal.aborted).toBe(true)
    expect(uploads.files.size).toBe(0)
    expect(cancelUpload).toHaveBeenCalledExactlyOnceWith(known ? "pending" : draft.id)
    await removeAttachmentUpload({ uploads, draft: pending })
    expect(cancelUpload).toHaveBeenCalledTimes(2)
    disposeAttachmentUploads(uploads)
  },
)

test("failed preparation metadata keeps local and inline files removable offline", async () => {
  const prepareUpload = vi.fn()
  const cancelPreparedUpload = vi.fn(() => Promise.reject(new Error("Offline")))
  const uploads = attachmentUploadState({
    prepareUpload,
    cancelPreparedUpload,
    captureAuthentication,
  } as unknown as AstralBeamChatCore)
  let state = { ...draft }
  startAttachmentUpload({
    uploads,
    draft: state,
    file: new File(["hello"], "note.txt"),
    settle: (update) => {
      state = { ...state, ...update }
    },
    persist: () => Promise.reject(new Error("Draft storage unavailable")),
  })
  await vi.waitFor(() => expect(state.status).toBe("ready"))
  expect(state.data).toBe("aGVsbG8=")
  expect(state.prepareAttempted).toBe(false)
  expect(prepareUpload).not.toHaveBeenCalled()
  for (const file of [
    state,
    { ...draft, status: "ready" as const, data: "aGVsbG8=" },
    { ...draft, kind: undefined },
  ])
    await removeAttachmentUpload({ uploads, draft: file })
  expect(cancelPreparedUpload).not.toHaveBeenCalled()
  disposeAttachmentUploads(uploads)
})

test("failed metadata persistence never converts an uncertain preparation to inline", async () => {
  const prepareUpload = vi.fn()
  const uploads = attachmentUploadState({
    prepareUpload,
    captureAuthentication,
  } as unknown as AstralBeamChatCore)
  let state: DraftAttachment = { ...draft, prepareAttempted: true }
  startAttachmentUpload({
    uploads,
    draft: state,
    file: new File(["hello"], "note.txt"),
    settle: (update) => {
      state = { ...state, ...update }
    },
    persist: () => Promise.reject(new Error("Draft storage unavailable")),
  })
  await vi.waitFor(() => expect(state.status).toBe("error"))
  expect(state.prepareAttempted).toBe(true)
  expect(readAttachmentData).not.toHaveBeenCalled()
  expect(prepareUpload).not.toHaveBeenCalled()
  disposeAttachmentUploads(uploads)
})

test.each([false, true])(
  "removal waits for preparation writes, including an immediate retry: %s",
  async (retry) => {
    let finish = () => {}
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    let stored: DraftAttachment[] = []
    const persist = vi.fn(async (file: DraftAttachment) => {
      if (file.prepareAttempted) await gate
      stored = [file]
    })
    const prepareUpload = vi.fn()
    const cancelPreparedUpload = vi.fn()
    const uploads = attachmentUploadState({
      prepareUpload,
      cancelPreparedUpload,
      captureAuthentication,
    } as unknown as AstralBeamChatCore)
    startAttachmentUpload({
      uploads,
      draft,
      file: new File(["hello"], "note.txt"),
      settle: () => {},
      persist,
    })
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    if (retry) resumeAttachmentUpload({ uploads, draft, settle: () => {}, persist })
    let removed = false
    const removal = removeAttachmentUpload({ uploads, draft }).then(() => {
      stored = []
      removed = true
    })
    await Promise.resolve()
    expect(removed).toBe(false)
    finish()
    await removal
    expect(stored).toEqual([])
    expect(prepareUpload).not.toHaveBeenCalled()
    expect(cancelPreparedUpload).not.toHaveBeenCalled()
    expect(persist.mock.calls.at(-1)?.[0].prepareAttempted).toBe(false)
    disposeAttachmentUploads(uploads)
  },
)

test("an uncertain preparation retries the same attachment key and retains a preparing session", async () => {
  const prepareUpload = vi
    .fn<(input: unknown) => Promise<unknown>>()
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValue({ ...session, status: "preparing" })
  const chat = {
    captureAuthentication,
    prepareUpload,
    getUpload: vi.fn(() => Promise.resolve({ ...session, status: "preparing" })),
  } as unknown as AstralBeamChatCore
  const uploads = attachmentUploadState(chat)
  let state = { ...draft }
  const settle = (update: Partial<DraftAttachment>) => {
    state = { ...state, ...update }
  }
  const persisted: DraftAttachment[] = []
  const persist = (file: DraftAttachment) => {
    persisted.push(file)
    return Promise.resolve()
  }
  startAttachmentUpload({
    uploads,
    draft: state,
    file: new File(["hello"], "note.txt"),
    settle,
    persist,
  })
  await vi.waitFor(() => expect(state.status).toBe("error"))
  resumeAttachmentUpload({ uploads, draft: state, settle, persist })
  await vi.waitFor(() => expect(state.status).toBe("error"), { timeout: 3_000 })
  expect(prepareUpload).toHaveBeenCalledTimes(2)
  for (const [input] of prepareUpload.mock.calls)
    expect(input).toMatchObject({ prepare_key: draft.id, agent_id: "origin-agent" })
  expect(state.sessionId).toBe("upload")
  expect(state.error).toContain("still preparing")
  expect(persisted).toHaveLength(2)
  expect(persisted[0]?.prepareAttempted).toBe(true)
  expect(persisted[0]?.sha256).toHaveLength(64)
  resumeAttachmentUpload({ uploads, draft: state, settle, persist })
  await vi.waitFor(() => expect(prepareUpload).toHaveBeenCalledTimes(3))
  expect(prepareUpload.mock.calls[2]?.[0]).toMatchObject({ prepare_key: draft.id })
  disposeAttachmentUploads(uploads)
})

test.each(["identity", "api", "remove identity", "401 refresh", "prepare identity"] as const)(
  "delayed attachment work respects authentication during %s",
  async (change) => {
    let user = {
      scope: "tenant",
      organization: { id: "organization" },
      tenant: { id: "tenant" },
      user: { id: "owner" },
    }
    const cancellations: string[] = []
    const preparations = vi.fn()
    vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(user))
      if (init?.method === "DELETE") {
        cancellations.push(url.href)
        if (change === "401 refresh" && cancellations.length === 1)
          return Promise.resolve(new Response(null, { status: 401 }))
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.pathname.endsWith("/chat/uploads") && init?.method === "POST") {
        preparations()
        return Promise.resolve(Response.json(session))
      }
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    })
    const chat = createAstralBeamChat({
      fetchAstralBeamToken: () => ({
        token: `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))}.signature`,
      }),
    })
    let finish = (_files: DraftAttachment[]) => {}
    let stored: DraftAttachment[] = [{ ...draft, prepareAttempted: true }]
    vi.mocked(storedThreadAttachments)
      .mockImplementation(({ update }) => {
        if (update) stored = update(stored)
        return Promise.resolve(stored)
      })
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    try {
      await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
      const auth = chat.getState().auth
      const isCurrentAuthentication = chat.captureAuthentication()
      const uploads = attachmentUploadState(chat)
      const waitForAuthChange = () =>
        vi.waitFor(() => {
          expect(chat.getState().auth.status).toBe("ready")
          expect(chat.getState().auth).not.toBe(auth)
        })
      const waitForUpload = () => vi.waitFor(() => expect(uploads.fileSlots.active).toBe(0))
      const options = {
        uploads,
        apiUrl: "https://api.test",
        identity: "owner",
        threadId: "conversation",
        attachments: [],
        isCurrentAuthentication,
      }
      if (change === "remove identity")
        uploads.tasks.set(draft.id, {
          controller: new AbortController(),
          prepareAttempted: true,
          preparation: storedThreadAttachments(options).then(() => undefined),
        })
      if (change === "prepare identity")
        startAttachmentUpload({
          uploads,
          draft,
          file: new File(["hello"], "note.txt"),
          isCurrentAuthentication,
          settle: () => {},
          persist: (file) =>
            storedThreadAttachments({ ...options, update: () => [file] }).then(() => undefined),
        })
      const cleanup =
        change === "remove identity"
          ? removeAttachmentUpload({ uploads, draft, isCurrentAuthentication })
          : change === "prepare identity"
            ? undefined
            : discardAttachmentUploads(options)
      const result = cleanup?.catch((error: unknown) => error)
      await vi.waitFor(() => expect(storedThreadAttachments).toHaveBeenCalledOnce())
      if (change !== "api" && change !== "401 refresh") {
        user = { ...user, user: { id: "replacement" } }
        chat.retryAuthentication()
      } else if (change === "api") chat.updateOptions({ apiUrl: "https://replacement.example/api" })
      if (change !== "401 refresh") await waitForAuthChange()
      finish([{ ...draft, prepareAttempted: true }])
      const settle = vi.fn()
      if (change === "prepare identity") {
        await waitForUpload()
        startAttachmentUpload({
          uploads,
          draft: { ...draft, id: "stale" },
          file: new File(["hello"], "note.txt"),
          isCurrentAuthentication,
          settle,
          persist,
        })
      }
      const error = await result
      expect(error instanceof Error ? error.message : undefined).toBe(
        change === "401 refresh" || change === "prepare identity"
          ? undefined
          : "Authentication changed",
      )
      expect(cancellations).toHaveLength(change === "401 refresh" ? 2 : 0)
      expect(chat.getState().auth).not.toBe(auth)
      expect(isCurrentAuthentication()).toBe(change === "401 refresh")
      expect(stored[0]?.prepareAttempted).toBe(
        change === "401 refresh" ? undefined : change !== "prepare identity",
      )
      expect(storedThreadAttachments).toHaveBeenCalledTimes(
        change === "401 refresh" || change === "prepare identity" ? 2 : 1,
      )
      expect(preparations).not.toHaveBeenCalled()
      expect(uploads.files.has("stale")).toBe(false)
      expect(settle).not.toHaveBeenCalled()
    } finally {
      finish([])
      chat.dispose()
    }
  },
)

test("partial discard retains files and previews until all cancellation and metadata cleanup succeed", async () => {
  const first = { ...draft, id: "first", sessionId: "first-session" }
  const second = { ...draft, id: "second", sessionId: "second-session" }
  let stored: DraftAttachment[] = [first, second]
  vi.mocked(storedThreadAttachments).mockImplementation(({ update }) => {
    if (update) stored = update(stored)
    return Promise.resolve(stored)
  })
  const cancelUpload = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(undefined)
  const uploads = attachmentUploadState({
    cancelUpload,
    captureAuthentication,
  } as unknown as AstralBeamChatCore)
  const revokeObjectURL = vi.fn()
  vi.stubGlobal("URL", { revokeObjectURL })
  for (const file of stored) {
    uploads.files.set(file.id, new File(["hello"], "note.txt"))
    uploads.previews.set(file.id, `blob:${file.id}`)
    uploads.tasks.set(file.id, { controller: new AbortController(), prepareAttempted: true })
  }
  const discard = () =>
    discardAttachmentUploads({
      uploads,
      apiUrl: "https://api.test",
      identity: "owner",
      threadId: "conversation",
      attachments: [],
    })
  await expect(discard()).rejects.toThrow("Offline")
  expect(stored).toEqual([first, second])
  expect(uploads.files.size).toBe(2)
  expect(uploads.previews.size).toBe(2)
  expect([...uploads.tasks.values()].every((task) => task.controller.signal.aborted)).toBe(true)
  expect(revokeObjectURL).not.toHaveBeenCalled()
  await discard()
  expect(stored).toEqual([])
  expect(uploads.files.size).toBe(0)
  expect(uploads.tasks.size).toBe(0)
  expect(uploads.previews.size).toBe(0)
  expect(revokeObjectURL).toHaveBeenCalledTimes(2)
})

test("discard retains targets when authentication changes before the IndexedDB update", async () => {
  let authorized = true
  let stored: DraftAttachment[] = [{ ...draft, prepareAttempted: true }]
  const cancelPreparedUpload = vi.fn(() => Promise.resolve())
  const uploads = attachmentUploadState({
    cancelPreparedUpload,
    captureAuthentication: () => () => authorized,
  } as unknown as AstralBeamChatCore)
  vi.mocked(storedThreadAttachments).mockImplementation(({ update }) =>
    Promise.resolve().then(() => {
      if (update) {
        authorized = false
        stored = update(stored)
      }
      return stored
    }),
  )
  await expect(
    discardAttachmentUploads({
      uploads,
      apiUrl: "https://api.test",
      identity: "owner",
      threadId: "conversation",
      attachments: [],
    }),
  ).rejects.toThrow("Authentication changed")
  expect(cancelPreparedUpload).toHaveBeenCalledOnce()
  expect(stored).toEqual([{ ...draft, prepareAttempted: true }])
})

test("removal and discard retain transitioning targets and leave claimed files to their conversation", async () => {
  const conflict = Object.assign(new Error("Retry completion"), {
    name: "AstralBeamApiError",
    status: 409,
    body: { type: "about:blank" },
  })
  const claimed = Object.assign(new Error("Claimed"), {
    name: "AstralBeamApiError",
    status: 409,
    body: { type: "urn:file-upload:claimed" },
  })
  const cancelUpload = vi
    .fn()
    .mockRejectedValueOnce(claimed)
    .mockRejectedValueOnce(conflict)
    .mockRejectedValueOnce(conflict)
    .mockRejectedValue(claimed)
  const uploads = attachmentUploadState({
    cancelUpload,
    captureAuthentication,
  } as unknown as AstralBeamChatCore)
  const pending = { ...draft, sessionId: "pending" }
  const discard = () =>
    discardAttachmentUploads({
      uploads,
      apiUrl: "https://api.test",
      identity: "owner",
      threadId: "conversation",
      attachments: [],
    })
  vi.mocked(storedThreadAttachments).mockRejectedValueOnce(new Error("Storage unavailable"))
  await expect(discard()).rejects.toThrow("Storage unavailable")
  expect(cancelUpload).not.toHaveBeenCalled()
  await removeAttachmentUpload({ uploads, draft: pending })
  await expect(removeAttachmentUpload({ uploads, draft: pending })).rejects.toBe(conflict)
  vi.mocked(storedThreadAttachments).mockResolvedValueOnce([pending])
  await expect(discard()).rejects.toBe(conflict)
  expect(vi.mocked(storedThreadAttachments).mock.calls.at(-1)?.[0]).not.toHaveProperty("update")
  vi.mocked(storedThreadAttachments).mockResolvedValueOnce([pending])
  await discard()
  expect(cancelUpload).toHaveBeenCalledTimes(4)
  expect(vi.mocked(storedThreadAttachments).mock.calls.at(-1)?.[0]).toHaveProperty("update")
  disposeAttachmentUploads(uploads)
})
