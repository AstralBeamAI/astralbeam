"use client"

import { ShieldCheckIcon } from "@phosphor-icons/react"
import { type FormEvent, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { loginOperator } from "../-functions/login-operator"

export function OperatorLoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [key, setKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submitOperatorLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await loginOperator({ data: { key } })
      if (result.ok) {
        onLoggedIn()
        return
      }
      setError(result.error ?? "Login failed")
    } catch {
      setError("Login failed")
    } finally {
      setKey("")
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon aria-hidden="true" />
          Operator Sign-In
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submitOperatorLogin} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Enter the first active value from <code>DATABASE_ENCRYPTION_KEY</code>.
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="database-encryption-key">Encryption key</FieldLabel>
            <Input
              id="database-encryption-key"
              name="key"
              type="password"
              autoComplete="off"
              maxLength={1024}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              required
              disabled={pending}
            />
            <FieldDescription>
              The key is verified against the environment and is never stored in the database.
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
