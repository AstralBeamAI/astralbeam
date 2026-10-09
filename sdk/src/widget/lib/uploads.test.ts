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
const auth = { status: "loading" as const }

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
      getState: () => ({ auth }),
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
    getState: () => ({ auth }),
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
  const uploads = attachmentUploadState({ prepareUpload } as unknown as AstralBeamChatCore)
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
      getState: () => ({ auth }),
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

test.each(["identity", "api", "remove identity"] as const)(
  "cleanup retains delayed IndexedDB targets through %s changes",
  async (change) => {
    let user = {
      scope: "tenant",
      organization: { id: "organization" },
      tenant: { id: "tenant" },
      user: { id: "owner" },
    }
    const cancellations: string[] = []
    vi.stubGlobal("fetch", (input: string | URL, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname.endsWith("/me")) return Promise.resolve(Response.json(user))
      if (init?.method === "DELETE") {
        cancellations.push(url.href)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(Response.json({ capabilities: { attachments: true } }))
    })
    const chat = createAstralBeamChat({
      fetchAstralBeamToken: () => ({
        token: `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))}.signature`,
      }),
    })
    let finish = (_files: DraftAttachment[]) => {}
    vi.mocked(storedThreadAttachments).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    try {
      await vi.waitFor(() => expect(chat.getState().auth.status).toBe("ready"))
      const auth = chat.getState().auth
      const uploads = attachmentUploadState(chat)
      const options = {
        uploads,
        apiUrl: "https://api.test",
        identity: "owner",
        threadId: "conversation",
        attachments: [],
        auth,
      }
      if (change === "remove identity")
        uploads.tasks.set(draft.id, {
          controller: new AbortController(),
          prepareAttempted: true,
          preparation: storedThreadAttachments(options).then(() => undefined),
        })
      const cleanup =
        change === "remove identity"
          ? removeAttachmentUpload({ uploads, draft, auth })
          : discardAttachmentUploads(options)
      await vi.waitFor(() => expect(storedThreadAttachments).toHaveBeenCalledOnce())
      if (change !== "api") {
        user = { ...user, user: { id: "replacement" } }
        chat.retryAuthentication()
      } else chat.updateOptions({ apiUrl: "https://replacement.example/api" })
      await vi.waitFor(() => {
        expect(chat.getState().auth.status).toBe("ready")
        expect(chat.getState().auth).not.toBe(auth)
      })
      finish([{ ...draft, prepareAttempted: true }])
      await expect(cleanup).rejects.toThrow("Authentication changed")
      expect(cancellations).toEqual([])
      expect(storedThreadAttachments).toHaveBeenCalledOnce()
    } finally {
      finish([])
      chat.dispose()
    }
  },
)

test("discard retains targets when authentication changes before the IndexedDB update", async () => {
  const auth = { status: "loading" as const }
  let current = auth
  let stored: DraftAttachment[] = [{ ...draft, prepareAttempted: true }]
  const cancelPreparedUpload = vi.fn(() => Promise.resolve())
  const uploads = attachmentUploadState({
    cancelPreparedUpload,
    getState: () => ({ auth: current }),
  } as unknown as AstralBeamChatCore)
  vi.mocked(storedThreadAttachments).mockImplementation(({ update }) =>
    Promise.resolve().then(() => {
      if (update) {
        current = { status: "loading" }
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
      auth,
    }),
  ).rejects.toThrow("Authentication changed")
  expect(cancelPreparedUpload).toHaveBeenCalledOnce()
  expect(stored).toEqual([{ ...draft, prepareAttempted: true }])
})

test("discard retains unreadable or transitioning targets and leaves claimed files to their conversation", async () => {
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
    .mockRejectedValue(claimed)
  const auth = { status: "loading" as const }
  const uploads = attachmentUploadState({
    cancelUpload,
    getState: () => ({ auth }),
  } as unknown as AstralBeamChatCore)
  const pending = { ...draft, sessionId: "pending" }
  const discard = () =>
    discardAttachmentUploads({
      uploads,
      apiUrl: "https://api.test",
      identity: "owner",
      threadId: "conversation",
      attachments: [],
      auth,
    })
  vi.mocked(storedThreadAttachments).mockRejectedValueOnce(new Error("Storage unavailable"))
  await expect(discard()).rejects.toThrow("Storage unavailable")
  expect(cancelUpload).not.toHaveBeenCalled()
  await expect(removeAttachmentUpload({ uploads, draft: pending })).rejects.toBe(claimed)
  vi.mocked(storedThreadAttachments).mockResolvedValueOnce([pending])
  await expect(discard()).rejects.toBe(conflict)
  expect(vi.mocked(storedThreadAttachments).mock.calls.at(-1)?.[0]).not.toHaveProperty("update")
  vi.mocked(storedThreadAttachments).mockResolvedValueOnce([pending])
  await discard()
  expect(cancelUpload).toHaveBeenCalledTimes(3)
  expect(vi.mocked(storedThreadAttachments).mock.calls.at(-1)?.[0]).toHaveProperty("update")
  disposeAttachmentUploads(uploads)
})
