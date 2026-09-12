"use client"

import { useRouter } from "@tanstack/react-router"
import { type SyntheticEvent, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { isValidOpenaiApiKey, OPENAI_API_KEY_VALIDATION_MESSAGE } from "@/lib/schemas"
import { updateOrganizationOpenaiApiKey } from "../-functions/update-organization-openai-api-key"

export type OrganizationOpenaiApiKeyCardProps = {
  organizationSlug: string
  configured: boolean
  readOnly: boolean
}

export function OrganizationOpenaiApiKeyCard({
  organizationSlug,
  configured,
  readOnly,
}: OrganizationOpenaiApiKeyCardProps) {
  const router = useRouter()
  const [apiKey, setApiKey] = useState("")
  const [pending, setPending] = useState(false)
  const trimmedApiKey = apiKey.trim()

  const submit = async (value: string | null) => {
    setPending(true)
    try {
      const result = await updateOrganizationOpenaiApiKey({
        data: { organizationSlug, apiKey: value },
      })
      if (!result.ok) {
        toast.add({ title: result.message, type: "error" })
        return
      }
      setApiKey("")
      toast.add({
        title: value === null ? "OpenAI API key removed" : "OpenAI API key saved",
        type: "success",
      })
      await router.invalidate()
    } catch {
      toast.add({ title: "The OpenAI API key could not be saved. Try again.", type: "error" })
    } finally {
      setPending(false)
    }
  }

  const save = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (readOnly || !isValidOpenaiApiKey(trimmedApiKey)) return
    void submit(trimmedApiKey)
  }

  return (
    <form onSubmit={save} className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="min-w-0 flex-1">OpenAI API key</span>
            <Badge variant={configured ? "secondary" : "destructive"}>
              {configured ? "Configured" : "Not configured"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Every chat run for this organization streams on this key, and it is stored encrypted.
            Until one is set, the embedded agent answers each message with an error.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="organization-openai-api-key">
              {configured ? "Replacement key" : "Key"}
            </FieldLabel>
            <Input
              id="organization-openai-api-key"
              type="password"
              value={apiKey}
              autoComplete="off"
              placeholder="sk-…"
              disabled={pending || readOnly}
              onChange={(event) => setApiKey(event.target.value)}
              className="font-mono text-xs"
            />
            <FieldDescription>
              {trimmedApiKey.length > 0 && !isValidOpenaiApiKey(trimmedApiKey)
                ? OPENAI_API_KEY_VALIDATION_MESSAGE
                : configured
                ? "A stored key is never shown again. Saving a new one replaces it."
                : "Create a key in the OpenAI dashboard and paste it here."}
            </FieldDescription>
          </Field>
        </CardContent>
        {!readOnly && (
          <CardFooter className="justify-end gap-2">
            {configured && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => void submit(null)}
              >
                Remove key
              </Button>
            )}
            <Button type="submit" disabled={pending || !isValidOpenaiApiKey(trimmedApiKey)}>
              {pending ? "Saving…" : configured ? "Replace key" : "Save key"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}
