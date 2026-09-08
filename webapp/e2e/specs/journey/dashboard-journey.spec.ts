import { baselineStatePath, writeBaseline } from "../../baseline.ts"
import { captureMilestone } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"
import { makeRunIdentity } from "../../identity.ts"
import { emailLink, waitForEmail } from "../../mailbox.ts"
import { mailboxSmtpPort, operatorKey, webappUrl } from "../../worktree.ts"

/**
 * One continuous session over an empty deployment: configure it, create an account, verify its
 * email, create an organization, and then work through every organization page. Each step is
 * composed from the page objects in `e2e/pages`, so a narrower spec can reuse the same parts.
 *
 * This is also the suite's setup project. It ends by recording the configured deployment and the
 * signed-in owner, which every spec under `specs/features` depends on.
 */
test("an operator configures the deployment and an owner runs the dashboard end to end", async ({ page, agents, apiKeys, auth, configure, members, onboarding, organizationDialog, organizationSettings, sandboxes, shell, userSettings }) => {
  const identity = makeRunIdentity()
  const renamedOrganization = `${identity.organizationName} Renamed`
  const movedSlug = `${identity.organizationSlug}-moved`

  await test.step("an operator configures an unconfigured deployment", async () => {
    await configure.open()
    await configure.signIn(operatorKey)
    await expect(configure.setupStatus()).toHaveText("Configuration required")

    expect(
      await configure.isEnvironmentProvided("better_auth_secret"),
      "BETTER_AUTH_SECRET is set in the environment, so this run cannot exercise /configure",
    ).toBe(false)
    await configure.generateSecret("better_auth_secret")

    // Points the deployment at the suite's mail sink, which every later email step depends on.
    await configure.setValue("smtp_port", String(mailboxSmtpPort))
    await configure.testEmailConnection()
    await configure.save()

    await expect(configure.setupStatus()).toHaveText("Configuration is complete")
    await captureMilestone(page, "01-configure-complete")
    await configure.goToApp()
  })

  await test.step("a visitor signs up and verifies their email address", async () => {
    await page.waitForURL(/\/auth\/sign-in/)
    await auth.open("sign-up")
    await auth.signUp(identity)
    await page.waitForURL(/\/auth\/verify-email/)
    await captureMilestone(page, "02-verify-email-prompt")

    const verification = await waitForEmail(identity.email)
    expect(verification.subject).toMatch(/verif/i)
    const verificationLink = emailLink(verification, /\/api\/auth\/verify-email/)
    // Links are built from the configured base URL, so this catches a misconfigured deployment.
    expect(verificationLink).toContain(webappUrl)
    await auth.completeEmailVerification(verificationLink)
  })

  await test.step("verification signs the new account in and asks it for an organization", async () => {
    await onboarding.expectVisible()
    await captureMilestone(page, "03-onboarding")
    await onboarding.openCreateOrganization()
    await organizationDialog.create(identity.organizationName, identity.organizationSlug)
    await page.waitForURL(`**/${identity.organizationSlug}`)
    await expect(page.getByRole("heading", { level: 1, name: identity.organizationName }))
      .toBeVisible()
    await captureMilestone(page, "04-dashboard")
  })

  await test.step("the dashboard counts the resources a new organization starts with", async () => {
    // Creating an organization provisions its starter agent, so Agents starts at one.
    await expect(page.getByRole("link", { name: /^Agents 1/ })).toBeVisible()
    await expect(page.getByRole("link", { name: /^Members 1/ })).toBeVisible()
    expect(await shell.visibleSections()).toEqual([
      "Home",
      "Agents",
      "Sandboxes",
      "API keys",
      "Members",
      "Settings",
    ])
  })

  await test.step("the owner edits the starter agent and adds a second one", async () => {
    await shell.openSection("Agents", "Agents")
    const starterAgent = `${identity.organizationName} Assistant`
    await expect(agents.cards()).toHaveCount(1)

    await agents.openAgent(starterAgent)
    await expect(agents.publicId()).toHaveValue(/^agent_[0-9a-f-]{36}_[0-9a-f-]{36}$/)
    await expect(agents.defaultBadge()).toBeVisible()
    await agents.fillForm({
      name: starterAgent,
      systemPrompt: "You answer questions about this end-to-end run and nothing else.",
    })
    await agents.saveChanges()

    await shell.openSection("Agents", "Agents")
    await agents.startCreate()
    await agents.fillForm({
      name: `Support agent ${identity.runId}`,
      systemPrompt: "You are a support assistant created by the end-to-end suite.",
      attachmentsEnabled: false,
    })
    await agents.submitCreate()
    await agents.setAsDefault()
    await captureMilestone(page, "05-agent-detail")

    await shell.openSection("Agents", "Agents")
    await expect(agents.cards()).toHaveCount(2)
  })

  await test.step("the owner reviews the sandbox providers page", async () => {
    await shell.openSection("Sandboxes", "Sandboxes")
    await expect(sandboxes.emptyState()).toBeVisible()
    // Creating one runs a real connection test against a container, which `specs/sandbox` covers
    // on request; the journey stays deterministic and stops at the form.
    await sandboxes.startCreate()
    await captureMilestone(page, "06-sandboxes")
  })

  await test.step("the owner issues an API key and then revokes it", async () => {
    await shell.openSection("API keys", "API keys")
    const keyName = `Journey key ${identity.runId}`
    const credential = await apiKeys.createKey(keyName)
    // The one-time credential is assembled from database IDs: key_<organization>_<id>_<secret>.
    expect(credential).toMatch(/^key_[0-9a-f-]{36}_[0-9a-f-]{36}_abo_[A-Za-z0-9]+$/)
    await captureMilestone(page, "07-api-keys")
    await apiKeys.deleteKey(keyName)
  })

  await test.step("the owner invites a member, which sends a real invitation email", async () => {
    await shell.openSection("Members", "Members")
    await expect(members.memberRow(identity.email)).toBeVisible()

    await members.invite(identity.inviteeEmail)
    const invitation = await waitForEmail(identity.inviteeEmail)
    expect(invitation.subject).toContain(identity.organizationName)
    expect(emailLink(invitation, /accept-invitation/)).toContain(`${webappUrl}/auth/`)
    await captureMilestone(page, "08-members")

    await members.cancelInvitation(identity.inviteeEmail)
  })

  await test.step("the owner renames the organization and moves its slug", async () => {
    await shell.openSection("Settings", "Organization settings")
    await organizationSettings.rename(renamedOrganization)
    await expect(shell.organizationSwitcher(renamedOrganization)).toBeVisible()
    await organizationSettings.changeSlug(movedSlug)
    await captureMilestone(page, "09-organization-settings")
  })

  await test.step("the owner updates their own account and reviews security settings", async () => {
    await shell.openUserMenuItem(/^account$/i, "Account settings")
    await userSettings.setDisplayName(`${identity.name} Updated`)
    await captureMilestone(page, "10-account-settings")

    await userSettings.openSecurity()
    await expect(userSettings.changePasswordCard()).toBeVisible()
    await expect(userSettings.activeSessionsCard()).toBeVisible()
  })

  await test.step("the owner creates a second organization and switches between them", async () => {
    await page.goto(`/${movedSlug}`)
    await shell.openCreateOrganization(renamedOrganization)
    await organizationDialog.create(
      identity.secondOrganizationName,
      identity.secondOrganizationSlug,
    )
    await page.waitForURL(`**/${identity.secondOrganizationSlug}`)

    await shell.switchOrganization(identity.secondOrganizationName, renamedOrganization)
    await page.waitForURL(`**/${movedSlug}`)

    await page.goto("/organizations")
    await expect(page.getByRole("heading", { level: 1, name: "Organizations" })).toBeVisible()
    await expect(page.getByText(identity.secondOrganizationName)).toBeVisible()
    await captureMilestone(page, "11-organizations")
  })

  await test.step("the public documentation renders", async () => {
    await page.goto("/docs")
    await expect(page.getByRole("heading", { level: 1, name: "Documentation" })).toBeVisible()
    await page.getByRole("link").filter({ hasText: /sdk/i }).first().click()
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await captureMilestone(page, "12-docs")
  })

  await test.step("signing out and back in returns the owner to their dashboard", async () => {
    await page.goto(`/${movedSlug}`)
    await shell.signOut()

    await auth.signIn(identity.email, identity.password)
    await page.waitForURL(`**/${movedSlug}`)
    await expect(page.getByRole("heading", { level: 1, name: renamedOrganization })).toBeVisible()
    await captureMilestone(page, "13-signed-back-in")
  })

  await test.step("the run records its baseline for the feature specs", async () => {
    writeBaseline({
      email: identity.email,
      password: identity.password,
      organizationName: renamedOrganization,
      organizationSlug: movedSlug,
    })
    await page.context().storageState({ path: baselineStatePath })
  })
})
