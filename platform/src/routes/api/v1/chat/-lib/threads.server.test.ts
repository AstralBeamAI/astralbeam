import { Effect } from "effect"
import { expect, test } from "vitest"
import type { MessageRecord } from "@/lib/chat/threads/threads.server"
import { ChatFiles } from "@/lib/chat/attachments/chat-files.server"
import { ObjectStorage } from "@/lib/storage/object-storage.server"
import { messageResource, savedChatAttachmentResponse } from "./threads.server"

test("opaque provider file handles remain context and never reach UUID download lookup", async () => {
  const part = {
    id: "part",
    type: "document",
    source: { type: "file", value: "file-provider-context", mimeType: "application/pdf" },
  }
  const message = { payload: { version: 1, parts: [part] } } as unknown as MessageRecord
  expect(messageResource(message).parts).toEqual([part])
  expect(
    await Effect.runPromise(
      savedChatAttachmentResponse(message, "part").pipe(
        Effect.provideService(ChatFiles, {} as typeof ChatFiles.Service),
        Effect.provideService(ObjectStorage, {} as typeof ObjectStorage.Service),
        Effect.result,
      ),
    ),
  ).toMatchObject({ _tag: "Failure", failure: { _tag: "ChatThreadNotFound" } })
})

test.each(["audio", "video"])(
  "stored %s exposes a download marker without its internal file reference",
  (type) => {
    const part = {
      id: "saved-media",
      type,
      source: {
        type: "file",
        provider: "astralbeam",
        value: "01990a5d-ac96-774b-b942-6b13c85384cd",
        mimeType: `${type}/mp4`,
      },
    }
    const message = { payload: { version: 1, parts: [part] } } as unknown as MessageRecord
    expect(messageResource(message).parts).toEqual([
      { ...part, source: { type: "attachment", mimeType: `${type}/mp4` } },
    ])
  },
)
