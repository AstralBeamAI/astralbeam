import { expect, test } from "../../fixtures.ts"
import { makeRunIdentity } from "../../identity.ts"

for (const clipboardResult of ["rejected", "unavailable"] as const) {
  test(`a ${clipboardResult} clipboard offers manual copying without losing the new API key`, async ({
    page,
    baseline,
    apiKeys,
  }) => {
    const name = `Clipboard ${makeRunIdentity().runId}`
    await page.goto(`/${baseline.organizationSlug}/api-keys`)
    await apiKeys.createKeyAndKeepDialogOpen(name)

    await apiKeys.setClipboardResult("success")
    await apiKeys.newKeyCopyButton.click()
    await expect(apiKeys.newKeyCopyButton).toHaveAccessibleName(/copied to clipboard/i)

    await apiKeys.setClipboardResult(clipboardResult)
    await apiKeys.newKeyCopyButton.click()
    await expect(apiKeys.manualCopyHelp).toBeVisible()
    await expect(apiKeys.newKeyCopyButton).toHaveAccessibleName(/copy to clipboard/i)
    await expect(apiKeys.newKeyField).toBeFocused()
    await expect(apiKeys.newKeyField).toHaveAccessibleDescription(/copy the selected key/i)
    await expect
      .poll(() =>
        apiKeys.newKeyField.evaluate(
          (field) =>
            field instanceof HTMLInputElement &&
            field.value.length > 0 &&
            field.selectionStart === 0 &&
            field.selectionEnd === field.value.length,
        ),
      )
      .toBe(true)
    await page.keyboard.press("Escape")
    await expect(apiKeys.newKeyField).toBeVisible()

    await apiKeys.setClipboardResult("success")
    await apiKeys.newKeyCopyButton.click()
    await expect(apiKeys.newKeyCopyButton).toHaveAccessibleName(/copied to clipboard/i)
    await expect(apiKeys.manualCopyHelp).toBeHidden()
    await expect(apiKeys.newKeyField).toBeVisible()
    await apiKeys.dismissCreatedKey()
    await apiKeys.deleteKey(name)
  })
}
