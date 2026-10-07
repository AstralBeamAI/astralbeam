import { expect, test } from "../../fixtures.ts"
import { captureMoment } from "../../capture.ts"

test("the assistant and appearance persist across all example pages", async ({
  todos,
  chat,
  page,
}) => {
  await chat.waitForReady()
  await todos.search.fill("launch")
  await expect(todos.items()).toHaveCount(1)
  await todos.search.fill("")
  await todos.cycleTheme()
  await chat.composer().fill("Keep this draft while browsing")
  for (const name of ["Users", "Conversations", "Todos"] as const) {
    await todos.navigate(name)
    await expect(page.getByRole("heading", { name, level: 1, exact: true })).toBeVisible()
    await expect(chat.composer()).toHaveValue("Keep this draft while browsing")
    await expect(todos.controls.theme).toHaveText("Theme: light")
    await captureMoment(page, `shared-assistant-${name.toLowerCase().replaceAll(" ", "-")}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await todos.navigate("Conversations")
  await expect(chat.composer()).toHaveValue("Keep this draft while browsing")
  await expect(page.locator(".app")).toHaveJSProperty("scrollWidth", 390)
  await captureMoment(page, "shared-assistant-mobile")
})

/**
 * The host application and the widget's chrome, with no model involved. Everything asserted here
 * is deterministic, so a failure is a real regression rather than an unlucky reply.
 */

test("added todos and completion survive reload", async ({ todos, page }) => {
  await todos.add("Water the plants")
  await expect(todos.items()).toHaveCount(4)
  await todos.checkbox("Water the plants").check()
  await expect(todos.checkbox("Water the plants")).toBeChecked()
  await page.reload()
  await todos.waitForHydration()
  await expect(todos.items()).toHaveCount(4)
  await expect(todos.checkbox("Water the plants")).toBeChecked()
  await todos.add("Water the garden")
  await todos.checkbox("Water the garden").check()
  await expect(todos.checkbox("Water the plants")).toBeChecked()
  await expect(todos.items()).toHaveCount(5)
})

test("the widget reaches a ready composer, which proves the token round-trip", async ({ chat }) => {
  await chat.waitForReady()
  // Nothing has been sent, so the widget offers its own empty transcript and no reset.
  await expect(chat.emptyState()).toBeVisible()
  await expect(chat.newChatButton()).toBeDisabled()
})

test("one theme control retunes the app and the widget together", async ({ todos, chat }) => {
  await chat.waitForReady()
  await expect(todos.controls.theme).toHaveText("Theme: system")

  await todos.cycleTheme()
  await expect(todos.controls.theme).toHaveText("Theme: light")
  expect(await todos.isDark()).toBe(false)

  await todos.cycleTheme()
  await expect(todos.controls.theme).toHaveText("Theme: dark")
  expect(await todos.isDark()).toBe(true)

  // The widget keeps its own palette inside the shadow root and must survive the switch.
  await expect(chat.composer()).toBeVisible()
})

test("hiding the assistant unmounts the widget and showing it mounts a new one", async ({
  todos,
  chat,
}) => {
  await chat.waitForReady()
  await todos.toggleAssistant()
  await expect(todos.controls.assistant).toHaveText("Show assistant")
  await expect(chat.root).toHaveCount(0)

  await todos.toggleAssistant()
  await expect(todos.controls.assistant).toHaveText("Hide assistant")
  await chat.waitForReady()
})

test("a tap beside the text focuses the message input", async ({ chat }) => {
  await chat.waitForReady()
  await expect(chat.composer()).not.toBeFocused()

  // The middle of the button row is padding: the attach button sits at its start, send at its end.
  await chat.composerButtonRow().click()
  await expect(chat.composer()).toBeFocused()
})
