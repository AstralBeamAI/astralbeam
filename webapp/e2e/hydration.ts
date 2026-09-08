import { expect, type Locator } from "@playwright/test"

/** React attaches own properties with this prefix to a host element as it hydrates it. */
const REACT_INSTANCE_KEY_PREFIX = "__react"

/**
 * Waits until React has attached to a control. Every page is server-rendered, so a button is
 * clickable before its handler exists, and that click is dropped or submits its form natively.
 */
export async function waitForHydration(locator: Locator): Promise<void> {
  await locator.waitFor()
  await expect.poll(
    () =>
      locator.evaluate(
        (node, prefix) => Object.keys(node).some((key) => key.startsWith(prefix)),
        REACT_INSTANCE_KEY_PREFIX,
      ),
    { timeout: 60_000, message: "React never attached to the control" },
  ).toBe(true)
}
