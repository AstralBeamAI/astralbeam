import { expect, test } from "../../fixtures.ts"

/**
 * The host application and the widget's chrome, with no model involved. Everything asserted here
 * is deterministic, so a failure is a real regression rather than an unlucky reply.
 */

test("renders the example's starting todos", async ({ todos }) => {
  await expect(todos.items()).toHaveCount(3)
  await expect(todos.item("Write the launch announcement")).toBeVisible()
  // The third starting todo ships completed, which is what makes the checkbox state meaningful.
  await expect(todos.checkbox("Book the offsite venue")).toBeChecked()
  await expect(todos.checkbox("Write the launch announcement")).not.toBeChecked()
})

test("adds and completes a todo in the host list", async ({ todos }) => {
  await todos.add("Water the plants")
  await expect(todos.items()).toHaveCount(4)
  await todos.checkbox("Water the plants").check()
  await expect(todos.checkbox("Water the plants")).toBeChecked()
})

test("the widget reaches a ready composer, which proves the token round-trip", async ({ chat }) => {
  await chat.waitForReady()
  // Nothing has been sent, so the widget offers its own empty transcript and no reset.
  await expect(chat.emptyState()).toBeVisible()
  await expect(chat.resetButton()).toBeDisabled()
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

test("the custom theme prop can be toggled without unmounting the widget", async ({ todos, chat }) => {
  await chat.waitForReady()
  await expect(todos.controls.customTheme).toHaveText("Custom theme: on")
  await todos.toggleCustomTheme()
  await expect(todos.controls.customTheme).toHaveText("Custom theme: off")
  await expect(chat.composer()).toBeVisible()
})

test("hiding the assistant unmounts the widget and showing it mounts a new one", async ({ todos, chat }) => {
  await chat.waitForReady()
  await todos.toggleAssistant()
  await expect(todos.controls.assistant).toHaveText("Show assistant")
  await expect(chat.root).toHaveCount(0)

  await todos.toggleAssistant()
  await expect(todos.controls.assistant).toHaveText("Hide assistant")
  await chat.waitForReady()
})

test("the debug switch reports its state", async ({ todos }) => {
  await expect(todos.controls.debug).toHaveText("Debug: off")
  await todos.toggleDebug()
  await expect(todos.controls.debug).toHaveText("Debug: on")
})
