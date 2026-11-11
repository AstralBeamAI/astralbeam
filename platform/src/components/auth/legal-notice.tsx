import { Fragment } from "react"

import { usePublicConfig } from "@/components/public-config-provider"

/** Continuing past sign-in or sign-up accepts the configured policies. */
export function LegalNotice() {
  const { privacyPolicyUrl, termsOfServiceUrl } = usePublicConfig()
  const links = [
    termsOfServiceUrl ? { href: termsOfServiceUrl, label: "Terms of Service" } : null,
    privacyPolicyUrl ? { href: privacyPolicyUrl, label: "Privacy Policy" } : null,
  ].filter((link) => link !== null)
  if (links.length === 0) return null

  return (
    <p className="text-center text-xs text-muted-foreground">
      By continuing, you agree to the{" "}
      {links.map((link, index) => (
        <Fragment key={link.label}>
          {index > 0 && " and "}
          <a
            href={link.href}
            className="whitespace-nowrap underline underline-offset-4 hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </a>
        </Fragment>
      ))}
      .
    </p>
  )
}
