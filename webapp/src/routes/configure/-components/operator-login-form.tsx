"use client"

import { DatabaseIcon } from "@phosphor-icons/react"
import { type FormEvent, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { loginOperator } from "../-functions/login-operator"

export function OperatorLoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submitOperatorLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await loginOperator({ data: { username, password } })
      if (result.ok) {
        onLoggedIn()
        return
      }
      setError(result.error ?? "Login failed")
    } catch {
      setError("Login failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon aria-hidden="true" />
          Operator Sign-In
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submitOperatorLogin} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Enter your database credentials for this deployment to manage the configuration.
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="operator-username">Database Username</FieldLabel>
            <Input
              id="operator-username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              disabled={pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="operator-password">Database Password</FieldLabel>
            <Input
              id="operator-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={pending}
            />
            <FieldDescription>
              Credentials are transmitted securely for verification and never stored.
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
