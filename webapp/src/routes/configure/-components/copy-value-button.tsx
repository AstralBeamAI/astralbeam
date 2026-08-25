"use client"

import { CopyIcon } from "@phosphor-icons/react"

import { InputGroupButton } from "@/components/ui/input-group"
import { toast } from "@/components/ui/toast"

export function CopyValueButton({ value, label }: { value: string; label: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.add({ title: "Copied to clipboard", type: "success" })
    } catch {
      toast.add({ title: "The value could not be copied", type: "error" })
    }
  }

  return (
    <InputGroupButton
      size="icon-xs"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => void handleCopy()}
    >
      <CopyIcon aria-hidden="true" />
    </InputGroupButton>
  )
}
