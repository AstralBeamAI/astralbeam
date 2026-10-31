"use client"

import { useAuth } from "@better-auth-ui/react"
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { cn } from "cn"
import { type ComponentProps, useState } from "react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

export function PasswordInput(props: Omit<ComponentProps<typeof InputGroupInput>, "type">) {
  const { localization } = useAuth()
  const [visible, setVisible] = useState(false)
  const label = visible ? localization.auth.hidePassword : localization.auth.showPassword

  return (
    <InputGroup>
      <InputGroupInput
        {...props}
        className={cn("ph-no-capture", props.className)}
        type={visible ? "text" : "password"}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={label}
          title={label}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeSlashIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
