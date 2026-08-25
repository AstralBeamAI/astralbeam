// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Use Phosphor icons and semantic shadcn colors, and route OAuth signup-disabled results to signup while preserving the return path.

"use client"

import {
  type AuthResult,
  getAuthLinkURL,
  getAuthResultMessage,
  parseAuthResult,
} from "@better-auth-ui/core"
import { useAuth } from "@better-auth-ui/react"
import {
  CheckCircleIcon as CircleCheckIcon,
  WarningIcon as TriangleAlertIcon,
  XCircleIcon as CircleXIcon,
} from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type AuthResultProps = {
  className?: string
  fallbackIntent: "danger" | "success"
}

function AuthResultView({ className, fallbackIntent }: AuthResultProps) {
  const { basePaths, localization, navigate, redirectTo, viewPaths } = useAuth()
  const [result, setResult] = useState<AuthResult>(() => parseAuthResult("", fallbackIntent))

  useEffect(() => {
    setResult(parseAuthResult(globalThis.location.search, fallbackIntent))
  }, [fallbackIntent])

  const message = getAuthResultMessage(result, localization)
  const action = (() => {
    if (result.reason === "signupDisabled") {
      return {
        label: localization.auth.signUp,
        to: getAuthLinkURL(
          `${basePaths.auth}/${viewPaths.auth.signUp}`,
          redirectTo,
        ),
      }
    }

    switch (result.action) {
      case "accountSettings":
        return {
          label: localization.auth.callbackViewAccountSettings,
          to: `${basePaths.settings}/${viewPaths.settings.security}`,
        }
      case "continue":
        return {
          label: localization.auth.callbackContinue,
          to: result.redirectTo ?? "/",
        }
      case "forgotPassword":
        return {
          label: localization.auth.forgotPassword,
          to: `${basePaths.auth}/${viewPaths.auth.forgotPassword}`,
        }
      case "signUp":
        return {
          label: localization.auth.signUp,
          to: `${basePaths.auth}/${viewPaths.auth.signUp}`,
        }
      case "verifyEmail":
        return {
          label: localization.auth.verifyEmail,
          to: `${basePaths.auth}/${viewPaths.auth.verifyEmail}`,
        }
      default:
        return {
          label: localization.auth.signIn,
          to: `${basePaths.auth}/${viewPaths.auth.signIn}`,
        }
    }
  })()
  const Icon = result.intent === "success"
    ? CircleCheckIcon
    : result.intent === "warning"
    ? TriangleAlertIcon
    : CircleXIcon

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <CardHeader className="justify-items-center text-center">
        <Icon
          aria-hidden="true"
          className={cn(
            "mb-1 size-10",
            result.intent === "success"
              ? "text-primary"
              : result.intent === "warning"
              ? "text-warning"
              : "text-destructive",
          )}
        />
        <CardTitle className="text-xl">
          <h1>{message.title}</h1>
        </CardTitle>
        <CardDescription>{message.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button className="w-full" onClick={() => navigate({ to: action.to })}>
          {action.label}
        </Button>
      </CardContent>
    </Card>
  )
}

export function AuthCallback(props: Omit<AuthResultProps, "fallbackIntent">) {
  return <AuthResultView {...props} fallbackIntent="success" />
}

export function AuthError(props: Omit<AuthResultProps, "fallbackIntent">) {
  return <AuthResultView {...props} fallbackIntent="danger" />
}
