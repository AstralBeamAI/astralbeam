import { describe, expect, it } from "vitest"

import { chatApiUrls } from "./constants.ts"

describe("chatApiUrls", () => {
  it("derives the chat routes from the hosted default", () => {
    expect(chatApiUrls(undefined)).toEqual({
      chat: "https://app.astralbeam.ai/api/v1/chat",
      config: "https://app.astralbeam.ai/api/v1/chat/config",
      files: "https://app.astralbeam.ai/api/v1/chat/files",
    })
  })

  it("derives them from a self-hosted base, trailing slashes and all", () => {
    expect(chatApiUrls("https://acme.example/api//")).toEqual({
      chat: "https://acme.example/api/v1/chat",
      config: "https://acme.example/api/v1/chat/config",
      files: "https://acme.example/api/v1/chat/files",
    })
  })

  it("keeps a relative base relative, for a same-origin deployment", () => {
    expect(chatApiUrls("/api").chat).toBe("/api/v1/chat")
  })
})
