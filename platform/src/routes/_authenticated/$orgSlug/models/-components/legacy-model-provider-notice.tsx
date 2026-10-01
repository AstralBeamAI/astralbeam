"use client"

import { useRouter } from "@tanstack/react-router"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "@/components/ui/toast"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { importLegacyModelProvider } from "../-functions/import-legacy-model-provider"

export function LegacyModelProviderNotice({
  organizationSlug,
  canImport,
}: {
  organizationSlug: string
  canImport: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const importOrganizationModelKey = async () => {
    setBusy(true)
    try {
      await importLegacyModelProvider({ data: { organizationSlug } })
      toast.add({ title: "OpenAI provider imported", type: "success" })
      await router.invalidate()
    } catch (error) {
      toast.add({ title: parseServerFnError(error).message, type: "error" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle>Move your existing OpenAI key</CardTitle>
        <CardDescription>
          Import the organization key as a named provider. Agents without models will receive its
          existing model, and the old key setting will be cleared.
        </CardDescription>
      </CardHeader>
      {canImport && (
        <CardContent>
          <Button disabled={busy} onClick={() => void importOrganizationModelKey()}>
            {busy ? "Importing…" : "Import existing key"}
          </Button>
        </CardContent>
      )}
    </Card>
  )
}
