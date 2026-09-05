import { captureMoment } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"

/**
 * A real agent run against the seeded `todos` agent: the host's client tools and the `todoCard`
 * widget, end to end.
 *
 * These spend model credits and the wording of a reply is not reproducible, so every assertion is
 * on an observable side effect: the host's own todo list, the tool rows the transcript shows, and
 * the cards projected into the conversation. Never assert on the assistant's prose.
 */

test("lists todos as live host widgets", async ({ page, todos, chat }) => {
  await chat.sendAndWait("Show me all of my todos.")

  await expect(chat.toolRow(/List the todos/)).toBeVisible()
  // One card per todo, rendered by the host's own component inside the conversation.
  await expect(todos.projectedCards()).toHaveCount(3)
  await captureMoment(page, "todo cards in the conversation")

  // The cards stay bound to host state, so toggling one in the chat updates the list behind it.
  await todos.projectedCard("Write the launch announcement").getByRole("checkbox").check()
  await expect(todos.checkbox("Write the launch announcement")).toBeChecked()
})

test("creates, updates, and deletes a todo through the host tools", async ({ todos, chat }) => {
  await chat.sendAndWait('Add a todo that says exactly "Buy oat milk".')
  await expect(chat.toolRow(/Create a todo/)).toBeVisible()
  await expect(todos.item("Buy oat milk")).toBeVisible()
  await expect(todos.checkbox("Buy oat milk")).not.toBeChecked()

  await chat.sendAndWait("Mark the oat milk todo as completed.")
  await expect(chat.toolRow(/Update a todo/)).toBeVisible()
  await expect(todos.checkbox("Buy oat milk")).toBeChecked()

  await chat.sendAndWait("Delete the oat milk todo.")
  await expect(chat.toolRow(/Delete a todo/)).toBeVisible()
  await expect(todos.item("Buy oat milk")).toHaveCount(0)
})

test("resetting the conversation clears the transcript but not host state", async ({ todos, chat }) => {
  await chat.sendAndWait('Add a todo that says exactly "Sharpen the pencils".')
  await expect(todos.item("Sharpen the pencils")).toBeVisible()

  await chat.reset()
  await expect(chat.emptyState()).toBeVisible()
  // The todo the agent created belongs to the host, so it survives the reset.
  await expect(todos.item("Sharpen the pencils")).toBeVisible()
})
