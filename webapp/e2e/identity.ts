/** Everything a run needs to be unique, so a flow can run twice against the same database. */
export type RunIdentity = {
  runId: string
  name: string
  email: string
  password: string
  organizationName: string
  organizationSlug: string
  secondOrganizationName: string
  secondOrganizationSlug: string
  inviteeEmail: string
}

export function makeRunIdentity(): RunIdentity {
  const runId = crypto.randomUUID().slice(0, 8)
  return {
    runId,
    name: `Ada E2E ${runId}`,
    email: `owner-${runId}@e2e.test`,
    // Random, because signing up checks the password against Have I Been Pwned.
    password: `E2e-${crypto.randomUUID()}`,
    organizationName: `Acme E2E ${runId}`,
    organizationSlug: `acme-e2e-${runId}`,
    secondOrganizationName: `Globex E2E ${runId}`,
    secondOrganizationSlug: `globex-e2e-${runId}`,
    inviteeEmail: `invitee-${runId}@e2e.test`,
  }
}
