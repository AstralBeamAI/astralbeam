"use client"

import { useRouter } from "@tanstack/react-router"
import { useInvalidateOrganizationPages } from "../../-lib/page-query"
import { useState } from "react"

import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import type { UsageLimit } from "@/lib/usage-limits/usage-limits.server"
import { setUsageLimitEnabled } from "../-functions/set-usage-limit-enabled"

/** Turns a limit's counting and enforcement on or off without opening its form. */
export function UsageLimitEnabledSwitch({
  organizationSlug,
  usageLimit,
  readOnly,
}: {
  organizationSlug: string
  usageLimit: UsageLimit
  readOnly: boolean
}) {
  const router = useRouter()
  const invalidatePages = useInvalidateOrganizationPages()
  const [saving, setSaving] = useState(false)

  const toggle = async (enabled: boolean) => {
    setSaving(true)
    try {
      await setUsageLimitEnabled({
        data: {
          organizationSlug,
          usageLimitId: usageLimit.id,
          lockVersion: usageLimit.lockVersion,
          enabled,
        },
      })
      toast.add({
        title: `${usageLimit.name} ${enabled ? "enabled" : "disabled"}`,
        type: "success",
      })
    } catch (error) {
      toast.add({ title: parseServerFnError(error).message, type: "error" })
    } finally {
      await invalidatePages()
      await router.invalidate()
      setSaving(false)
    }
  }

  return (
    <Switch
      checked={usageLimit.enabled}
      disabled={readOnly || saving}
      onCheckedChange={(enabled) => void toggle(enabled)}
      aria-label={`Enable ${usageLimit.name}`}
      title={usageLimit.enabled ? "Enabled: counted and enforced" : "Disabled: not counted"}
    />
  )
}
