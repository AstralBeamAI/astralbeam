import { Button } from "@astralbeam/ui/components/button"

export function EmailCta() {
  return (
    <Button
      className="h-11 px-5 text-sm"
      render={
        <a href="mailto:hello@astralbeam.ai?subject=Early%20design%20partner">
          Apply to be an early design partner
        </a>
      }
    />
  )
}
