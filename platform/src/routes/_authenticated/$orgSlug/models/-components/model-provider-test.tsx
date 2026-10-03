import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { OrganizationModelProvider } from "@/lib/model-providers/model-providers.server"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { testModelProvider } from "../-functions/test-model-provider"

export function ModelProviderTest({
  organizationSlug,
  provider,
  disabled,
}: {
  organizationSlug: string
  provider: OrganizationModelProvider
  disabled: boolean
}) {
  const [modelId, setModelId] = useState(provider.models[0]?.id ?? "")
  const test = useMutation({
    mutationKey: ["test-model-provider", provider.id],
    mutationFn: (selectedModelId: string) =>
      testModelProvider({
        data: {
          organizationSlug,
          id: provider.id,
          lockVersion: provider.lockVersion,
          modelId: selectedModelId,
        },
      }),
  })
  const { reset } = test
  useEffect(() => {
    if (disabled) reset()
  }, [disabled, reset])
  const unavailable = disabled || !provider.credentialsReadable || !modelId
  return (
    <Card>
      <CardHeader>
        <CardTitle>Test model</CardTitle>
        <CardDescription>
          Check that a saved model can reply using your API key. Your provider may charge for the
          request.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field>
          <FieldLabel htmlFor="model-provider-test-model">Model to test</FieldLabel>
          <Select
            items={provider.models.map((model) => ({ value: model.id, label: model.name }))}
            value={modelId}
            disabled={unavailable || test.isPending}
            onValueChange={(value) => {
              if (value) setModelId(value)
              test.reset()
            }}
          >
            <SelectTrigger id="model-provider-test-model" className="w-full">
              <SelectValue placeholder="Enable a model to test" />
            </SelectTrigger>
            <SelectContent>
              {provider.models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {unavailable && (
          <p className="text-sm text-muted-foreground">
            {disabled
              ? "Save your changes above before testing."
              : !provider.credentialsReadable
                ? "Enter an API key above, then save the provider."
                : "Enable a model above, then save the provider."}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={unavailable || test.isPending}
          onClick={() => test.mutate(modelId)}
        >
          {test.isPending ? "Testing…" : "Test model"}
        </Button>
        <div role="status" aria-atomic="true" className="space-y-2 text-sm">
          {test.isPending && <p>Waiting for a reply. This can take up to 30 seconds.</p>}
          {!disabled && test.isError && (
            <p className="text-destructive">{parseServerFnError(test.error).message}</p>
          )}
          {!disabled && test.isSuccess && (
            <>
              <p>
                {provider.models.find((model) => model.id === modelId)?.name} replied successfully.
              </p>
              <Link
                to="/$orgSlug/agents"
                params={{ orgSlug: organizationSlug }}
                className="underline underline-offset-4"
              >
                Set up an agent
              </Link>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
