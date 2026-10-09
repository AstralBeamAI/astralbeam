import { expect, test } from "vitest"
import { replaceArtifactContinuation } from "./artifact-migration.server"

test("artifact recovery rewrites only matching documented tool JSON", () => {
  const output = { fileId: "stored-file", availability: "available" }
  const metadata = {
    version: 1 as const,
    modelMessages: [
      {
        role: "tool",
        toolCallId: "published",
        content: JSON.stringify({ ticket: "old", path: "report.txt" }),
      },
      { role: "tool", content: { opaqueProviderContext: "old" } },
      { role: "assistant", content: JSON.stringify({ ticket: "old" }) },
      { role: "tool", content: JSON.stringify({ ticket: "different" }) },
    ],
  }
  const result = replaceArtifactContinuation(metadata, "old", output)
  expect(result.modelMessages?.[0]).toEqual({
    role: "tool",
    toolCallId: "published",
    content: JSON.stringify(output),
  })
  expect(result.modelMessages?.slice(1)).toEqual(metadata.modelMessages.slice(1))
})
