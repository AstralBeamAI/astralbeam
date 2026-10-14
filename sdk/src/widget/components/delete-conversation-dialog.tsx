import { useState, type RefObject } from "react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogCancel,
} from "./ui/alert-dialog.tsx"
import { Button } from "./ui/button.tsx"

export function DeleteConversationDialog({
  title,
  container,
  finalFocus,
  onDelete,
  onClose,
}: {
  title: string
  container: RefObject<HTMLDivElement | null>
  finalFocus: RefObject<HTMLButtonElement | null>
  onDelete: () => Promise<boolean>
  onClose: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !deleting) onClose()
      }}
    >
      <AlertDialogContent container={container} finalFocus={finalFocus}>
        <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
        <AlertDialogDescription className="break-words">
          Delete “{title}” and its messages? This cannot be undone.
        </AlertDialogDescription>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            Could not delete this conversation. Try again.
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              setDeleting(true)
              setFailed(false)
              void onDelete().then((deleted) => {
                setDeleting(false)
                if (deleted) onClose()
                else setFailed(true)
              })
            }}
          >
            {deleting ? "Deleting…" : "Delete conversation"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
