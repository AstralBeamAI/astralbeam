import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import type { StorageConnection } from "@/lib/storage/schemas"
import { testStorageConnection } from "../-functions/test-storage-connection"

export function StorageConnectionTest({
  settings,
  disabled,
}: {
  settings: StorageConnection | undefined
  disabled: boolean
}) {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ input: string; ok: boolean; message: string }>()
  const identity = JSON.stringify(settings)
  const current = result?.input === identity ? result : undefined
  async function handleStorageTest() {
    if (!settings) return
    setPending(true)
    try {
      const { ok } = await testStorageConnection({ data: settings })
      setResult({
        input: identity,
        ok,
        message: ok
          ? "Object upload, inspection, download, byte verification, and deletion passed."
          : "Storage test failed. Check the endpoint, bucket, credentials, and object permissions.",
      })
    } catch (error) {
      setResult({ input: identity, ok: false, message: parseServerFnError(error).message })
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border p-3">
      <p className="text-sm text-muted-foreground">
        Tests the current values without saving them. Creates and deletes a temporary object. Bucket
        privacy and browser CORS need separate configuration.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || pending || !settings}
        onClick={() => void handleStorageTest()}
      >
        {pending && <Spinner />}
        {pending ? "Testing storage" : "Test storage"}
      </Button>
      {!settings && (
        <p className="text-sm text-muted-foreground">
          Complete the connection settings and enter or reveal the credentials to test.
        </p>
      )}
      {current && (
        <Alert variant={current.ok ? "default" : "destructive"}>
          <AlertTitle>
            {current.ok ? "Storage connection succeeded" : "Storage connection failed"}
          </AlertTitle>
          <AlertDescription>{current.message}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
