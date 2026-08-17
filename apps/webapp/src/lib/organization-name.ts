const publicEmailDomains = new Set([
  "aol.com",
  "fastmail.com",
  "gmail.com",
  "googlemail.com",
  "gmx.com",
  "gmx.net",
  "hey.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "users.noreply.github.com",
  "yahoo.com",
  "ymail.com",
  "zoho.com",
])

const commonCountryCodeSecondLevelDomains = new Set(["ac", "co", "com", "edu", "gov", "net", "org"])

export function inferOrganizationName(email: string) {
  const separator = email.lastIndexOf("@")
  if (separator <= 0) return ""

  const domain = email
    .slice(separator + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/u, "")
  if (!domain || publicEmailDomains.has(domain)) return ""

  const labels = domain.split(".")
  if (labels.length < 2 || labels.some((label) => !label)) return ""

  const topLevelDomain = labels.at(-1)
  const secondLevelDomain = labels.at(-2)
  const usesCountryCodeSecondLevelDomain =
    topLevelDomain?.length === 2 &&
    secondLevelDomain !== undefined &&
    commonCountryCodeSecondLevelDomains.has(secondLevelDomain)
  const organizationLabel = labels.at(usesCountryCodeSecondLevelDomain ? -3 : -2)
  if (!organizationLabel) return ""

  return organizationLabel
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ")
}
