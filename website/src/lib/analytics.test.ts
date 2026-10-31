import { gzipSync } from "node:zlib"

import posthog, { type BeforeSendFn } from "posthog-js"
import { expect, test, vi } from "vitest"

test("preserves replay styling and ingestion metadata while redacting secrets", async () => {
  vi.stubGlobal("window", { location: { origin: "https://astralbeam.ai" } })
  const init = vi.spyOn(posthog, "init").mockReturnValue(posthog)
  try {
    await import("./analytics")
    const config = init.mock.calls[0]![1]!
    expect(config.session_recording!.recordBody).toBe(false)
    const maskAttribute = config.session_recording!.maskAttributeFn!
    const style = "display: grid; --th-token: #24292f"
    expect(maskAttribute("style", style)).toBe(style)
    expect(
      maskAttribute("src", "https://storage.example/file?X-Amz-Signature=private-signature"),
    ).toBe("https://storage.example/file?X-Amz-Signature=[REDACTED]")

    const beforeSend = config.before_send as BeforeSendFn
    const timestamp = new Date("2026-10-31T00:00:00Z")
    const nested = [{ token: "private-user-token", name: "Alice" }]
    const event = beforeSend({
      event: "$identify",
      uuid: "event-123",
      properties: {
        token: "phc_public-project-token",
        nested,
      },
      $set: { apiKey: "private-key" },
      timestamp,
    })
    expect(event).toMatchObject({
      properties: {
        token: "phc_public-project-token",
        nested: [{ token: "[REDACTED]", name: "Alice" }],
      },
      $set: { apiKey: "[REDACTED]" },
      timestamp,
    })
    expect(nested[0]!.token).toBe("private-user-token")

    // A stored gzip block makes credential-looking bytes deterministic inside opaque replay data.
    const compressed = gzipSync('"sk-compressed-sentinel"', { level: 0 }).toString("latin1")
    const compressedEvents = [
      { type: 2, cv: "2024-10", data: compressed },
      {
        type: 3,
        cv: "2024-10",
        data: { source: 0, texts: compressed },
      },
    ]
    expect(
      beforeSend({
        event: "$snapshot",
        uuid: "network-event",
        properties: {
          token: "phc_public-project-token",
          $snapshot_data: [
            ...compressedEvents,
            {
              type: 6,
              data: {
                plugin: "rrweb/network@1",
                payload: {
                  requests: [
                    {
                      name: "https://storage.example/file?X-Amz-Signature=private-signature&code=example",
                    },
                  ],
                },
              },
            },
          ],
        },
      }),
    ).toMatchObject({
      properties: {
        $snapshot_data: [
          ...compressedEvents,
          {
            data: {
              payload: {
                requests: [
                  {
                    name: "https://storage.example/file?X-Amz-Signature=[REDACTED]&code=example",
                  },
                ],
              },
            },
          },
        ],
      },
    })
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
