import { expect, test } from "../../fixtures.ts"
import { todosPage } from "../../pages/todos-page.ts"
import { chatWidget } from "../../pages/chat-widget.ts"
import { captureMoment } from "../../capture.ts"

// Exercise the built SDK through the consumer, with deterministic protocol events and saved history.
for (const name of ["show_todoCard", "update_todo"]) {
  test(`${name} delivers a normalized result and restores without execution`, async ({ page }) => {
    const thread = {
      id: "00000000-0000-4000-8000-000000000009",
      title: "Widget contracts",
      agent_id: null,
      version: 1,
      role: "manager",
      writer_active: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const presentation = name === "show_todoCard"
    const input = presentation ? { id: 1, highlight: true } : { id: 1, completed: true }
    let sends = 0
    let deliveries = 0
    let saved = false
    const call = {
      id: "widget-part",
      type: "tool-call",
      toolCallId: "widget-call",
      name,
      arguments: JSON.stringify(input),
      input,
      state: "input-complete",
      declaration: { resultVersion: 1, ...(presentation ? { widget: "todoCard" } : {}) },
      targets: [{ id: "target" }],
    }
    const data = { updated: { id: 1, text: "Write the launch announcement", completed: true } }
    const result = presentation
      ? { content: [{ type: "text", text: "Displayed todoCard" }] }
      : { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }
    await page.route("**/api/astralbeam/token", (route) =>
      route.fulfill({
        json: {
          token: `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))}.signature`,
        },
      }),
    )
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith("/me"))
        return route.fulfill({
          json: {
            scope: "tenant",
            organization: { id: "org" },
            tenant: { id: "tenant" },
            user: { id: "user" },
          },
        })
      if (path.endsWith("/chat/config"))
        return route.fulfill({ json: { capabilities: { attachments: true } } })
      if (path.endsWith("/threads"))
        return route.fulfill({
          json:
            route.request().method() === "POST"
              ? thread
              : { items: [thread], page_after: null, page_before: null },
        })
      if (path.endsWith("/messages"))
        return route.fulfill({
          json: {
            thread,
            messages: sends
              ? [
                  {
                    id: "assistant",
                    role: "assistant",
                    state: "complete",
                    created_at: thread.created_at,
                    parts: [call],
                  },
                  ...(saved
                    ? [
                        {
                          id: "result",
                          role: "tool",
                          state: "complete",
                          created_at: thread.created_at,
                          source_assistant_message_id: "assistant",
                          source_tool_part_id: "widget-part",
                          response_target_id: "target",
                          parts: [
                            {
                              id: "result-part",
                              type: "tool-result",
                              toolCallId: "widget-call",
                              outcome: "succeeded",
                              resultVersion: 1,
                              output: result,
                            },
                          ],
                        },
                      ]
                    : []),
                ]
              : [],
            pending_interactions:
              sends && !saved
                ? [
                    {
                      source_message_id: "assistant",
                      source_part_id: "widget-part",
                      response_target_id: "target",
                      tool_call_id: "widget-call",
                      target_tenant_user_id: "user",
                      target_client_id: null,
                      execution_location: "browser",
                    },
                  ]
                : [],
            page_after: null,
            page_before: null,
          },
        })
      const body = route.request().postDataJSON() as {
        runId?: string
        run_id?: string
        tools?: { name: string; parameters: unknown }[]
        forwardedProps?: { toolMetadata: Record<string, unknown> }
        results?: { output: unknown }[]
      }
      const run = { threadId: thread.id, runId: body.runId ?? body.run_id ?? "run" }
      let chunks: unknown[]
      if (path.endsWith("/tool-results")) {
        deliveries++
        expect(body.results?.[0]?.output).toEqual(result)
        saved = true
        chunks = [
          { type: "RUN_STARTED", ...run },
          { type: "RUN_FINISHED", ...run, metadata: { tanstack: { finishReason: "stop" } } },
        ]
      } else {
        sends++
        expect(body.tools?.find((tool) => tool.name === "show_todoCard")?.parameters).toMatchObject(
          {
            required: ["id"],
            properties: { id: { type: "number" } },
          },
        )
        expect(body.tools?.some((tool) => tool.name === "render_widget")).toBe(false)
        expect(body.forwardedProps?.toolMetadata[name]).toMatchObject({
          astralbeam: { resultVersion: 1, ...(presentation ? { widget: "todoCard" } : {}) },
        })
        chunks = [
          { type: "RUN_STARTED", ...run },
          {
            type: "CUSTOM",
            name: "astralbeam_thread",
            value: {
              threadId: thread.id,
              version: 2,
              saved: true,
              acceptedMessageId: "user-input",
              executableToolCallIds: ["widget-call"],
            },
          },
          {
            type: "TOOL_CALL_START",
            parentMessageId: "assistant",
            toolCallId: "widget-call",
            toolCallName: name,
          },
          { type: "TOOL_CALL_ARGS", toolCallId: "widget-call", delta: call.arguments },
          { type: "TOOL_CALL_END", toolCallId: "widget-call" },
          {
            type: "RUN_FINISHED",
            ...run,
            metadata: { tanstack: { finishReason: "tool_calls" } },
            outcome: {
              type: "interrupt",
              interrupts: [
                {
                  id: "client_tool_widget-call",
                  reason: "tanstack:client_tool_execution",
                  toolCallId: "widget-call",
                  responseSchema: {},
                  metadata: {
                    kind: "client_tool",
                    toolName: name,
                    input,
                    "tanstack:interruptBinding": {
                      v: 1,
                      kind: "client-tool-execution",
                      interruptId: "client_tool_widget-call",
                      toolName: name,
                      toolCallId: "widget-call",
                      interruptedRunId: run.runId,
                      generation: 0,
                      outputSchemaHash:
                        "sha256:eb045d78d273107348b0300c01d29b7552d622abbc6faf81b3ec55359aa9950c",
                      responseSchemaHash:
                        "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
                    },
                  },
                },
              ],
            },
          },
        ]
      }
      return route.fulfill({
        contentType: "text/event-stream",
        body: chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""),
      })
    })
    await todosPage(page).open()
    const chat = chatWidget(page)
    await chat.waitForReady()
    await chat.composer().fill(presentation ? "Show the launch todo" : "Complete the launch todo")
    await chat.composer().press("Enter")
    const card = page.locator(".todo-card")
    if (presentation) await expect(card).toContainText("Write the launch announcement")
    await expect.poll(() => deliveries).toBe(1)
    if (presentation) await card.getByRole("checkbox").check()
    const checkbox = page
      .getByRole("row")
      .filter({ hasText: "Write the launch announcement" })
      .getByRole("checkbox")
    await expect(checkbox).toBeChecked()
    await captureMoment(page, `${name}-live-host-state`)
    await page.reload()
    await chat.waitForReady()
    await expect(checkbox).toBeChecked()
    if (presentation) {
      await expect(card.getByRole("checkbox")).toBeChecked()
      await expect(card).toContainText("Write the launch announcement")
      await card.getByRole("checkbox").uncheck()
      await expect(checkbox).not.toBeChecked()
      await card.getByRole("checkbox").check()
      await expect(checkbox).toBeChecked()
    }
    expect(sends).toBe(1)
    expect(deliveries).toBe(1)
    await captureMoment(page, `${name}-restored-without-execution`)
  })
}
