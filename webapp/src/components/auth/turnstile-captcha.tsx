"use client"

import type { CaptchaRenderProps } from "@better-auth-ui/react/plugins/captcha"
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile"
import { useEffect, useRef, useState } from "react"
import { useTheme } from "tanstack-router-theme-provider"

import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { usePublicConfig } from "@/components/public-config-provider"

export function TurnstileCaptcha({ setToken, clearToken, setReset }: CaptchaRenderProps) {
  const { turnstileSiteKey } = usePublicConfig()
  const { theme } = useTheme()
  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined)
  const [error, setError] = useState<string>()

  useEffect(() => {
    setReset(() => turnstileRef.current?.reset())
    return () => setReset(null)
  }, [setReset])

  const clearTurnstile = (message: string) => {
    clearToken()
    setError(message)
  }

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel>Human verification</FieldLabel>
      <Turnstile
        ref={turnstileRef}
        siteKey={turnstileSiteKey}
        options={{
          theme: theme === "system" ? "auto" : theme,
          size: "flexible",
          responseField: false,
        }}
        onSuccess={(token) => {
          setError(undefined)
          setToken(token)
        }}
        onExpire={() => clearTurnstile("Human verification expired. Please try again.")}
        onError={() => clearTurnstile("Human verification failed to load. Please try again.")}
        onTimeout={() => clearTurnstile("Human verification timed out. Please try again.")}
        onUnsupported={() => clearTurnstile("Human verification is not supported by this browser.")}
        scriptOptions={{
          onError: () => clearTurnstile("Human verification failed to load. Please try again."),
        }}
      />
      <FieldError>{error}</FieldError>
    </Field>
  )
}
