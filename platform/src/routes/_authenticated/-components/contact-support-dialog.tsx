import { LifebuoyIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react"
import { type ChangeEvent, type SyntheticEvent, useRef, useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { sendSupportRequest } from "../-functions/send-support-request"
import {
  SUPPORT_ATTACHMENTS_MAX_BYTES,
  SUPPORT_ATTACHMENTS_MAX_COUNT,
  SUPPORT_MESSAGE_MAX_LENGTH,
} from "../-lib/constants"

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024)).toString()} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type ContactSupportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  supportEmailAddress: string
}

/** Sends a support request that emails the user a copy with the support address copied. */
export function ContactSupportDialog({
  open,
  onOpenChange,
  supportEmailAddress,
}: ContactSupportDialogProps) {
  const [message, setMessage] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [messageError, setMessageError] = useState<string>()
  const [attachmentError, setAttachmentError] = useState<string>()
  const [sending, setSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const next = [...files, ...Array.from(event.target.files ?? [])]
    event.target.value = ""
    if (next.length > SUPPORT_ATTACHMENTS_MAX_COUNT) {
      setAttachmentError(`Attach up to ${SUPPORT_ATTACHMENTS_MAX_COUNT.toString()} files`)
    } else if (next.reduce((total, file) => total + file.size, 0) > SUPPORT_ATTACHMENTS_MAX_BYTES) {
      setAttachmentError("Attachments must total 10 MB or less")
    } else {
      setFiles(next)
      setAttachmentError(undefined)
    }
  }

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending) return
    if (!message.trim()) {
      setMessageError("Must not be empty")
      return
    }
    const formData = new FormData()
    formData.append("message", message)
    formData.append("pagePath", `${window.location.pathname}${window.location.search}`)
    for (const file of files) formData.append("attachments[]", file)
    setSending(true)
    try {
      await sendSupportRequest({ data: formData })
      toast.add({
        title: "Message sent",
        description: "We emailed you a copy, and our team will reply to that thread.",
        type: "success",
      })
      setMessage("")
      setFiles([])
      onOpenChange(false)
    } catch (error) {
      toast.add({ title: parseServerFnError(error).message, type: "error" })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={messageRef}>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LifebuoyIcon />
              Contact Support
            </DialogTitle>
            <DialogDescription>
              Tell us what you need help with. We will email you a copy and reply from{" "}
              {supportEmailAddress}.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field data-invalid={!!messageError}>
              <FieldLabel htmlFor="contact-support-message">Message</FieldLabel>
              <Textarea
                id="contact-support-message"
                ref={messageRef}
                rows={6}
                className="max-h-72 min-h-32"
                maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
                placeholder="Describe the problem, what you expected, and the steps to reproduce it."
                value={message}
                disabled={sending}
                aria-invalid={!!messageError}
                aria-describedby={messageError ? "contact-support-message-error" : undefined}
                onChange={(event) => {
                  setMessage(event.target.value)
                  setMessageError(undefined)
                }}
              />
              <FieldError id="contact-support-message-error">{messageError}</FieldError>
            </Field>

            <Field data-invalid={!!attachmentError}>
              <FieldLabel htmlFor="contact-support-attachments">Attachments</FieldLabel>
              <input
                id="contact-support-attachments"
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                aria-describedby="contact-support-attachments-description"
                onChange={addFiles}
              />
              {files.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {files.map((file, index) => (
                    <li
                      key={`${index.toString()}-${file.name}`}
                      className="flex items-center gap-2 border px-2 py-1 text-xs"
                    >
                      <PaperclipIcon className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={file.name}>
                        {file.name}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatAttachmentSize(file.size)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${file.name}`}
                        title={`Remove ${file.name}`}
                        disabled={sending}
                        onClick={() => {
                          setFiles(files.filter((_, fileIndex) => fileIndex !== index))
                          setAttachmentError(undefined)
                        }}
                      >
                        <XIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sending || files.length >= SUPPORT_ATTACHMENTS_MAX_COUNT}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PaperclipIcon />
                  Attach files
                </Button>
              </div>
              <FieldDescription id="contact-support-attachments-description">
                Screenshots or files, up to {SUPPORT_ATTACHMENTS_MAX_COUNT} files and 10 MB in
                total.
              </FieldDescription>
              <FieldError>{attachmentError}</FieldError>
            </Field>
          </div>

          <DialogFooter>
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              disabled={sending}
              type="button"
            >
              Cancel
            </DialogClose>
            <Button type="submit" disabled={sending}>
              {sending && <Spinner />}
              Send message
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
