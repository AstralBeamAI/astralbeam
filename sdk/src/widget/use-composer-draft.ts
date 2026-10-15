import { useCallback, useEffect, useRef, useState } from "react"
import { newUuid } from "../core/threads.ts"
import type { DebugLogger } from "../lib/debug.ts"
import { storedThreadAttachments, storedThreadDraft } from "./lib/drafts.ts"
import type { DraftAttachment } from "./lib/types.ts"

const EMPTY_ATTACHMENTS: DraftAttachment[] = []

interface ThreadDraft {
  text: string
  attachments: DraftAttachment[]
  /** The last list written to storage. A failed write settles the UI but keeps the saved baseline. */
  settledAttachments: DraftAttachment[]
  savedAttachments: DraftAttachment[]
  attachmentsLoaded: boolean
  storageError: boolean
  /** A send the session owns until the server accepts it. Its text and files stay out of the composer. */
  submission?: Submission | undefined
}

interface Submission {
  id: string
  text: string
  fileIds: ReadonlySet<string>
  /** The draft's edit count when submitted, so later typing is never mistaken for the sent text. */
  edits: number
}

const EMPTY_DRAFT: ThreadDraft = {
  text: "",
  attachments: EMPTY_ATTACHMENTS,
  settledAttachments: EMPTY_ATTACHMENTS,
  savedAttachments: EMPTY_ATTACHMENTS,
  attachmentsLoaded: false,
  storageError: false,
}
const storedDraft = (apiUrl: string, identity: string, threadId: string): ThreadDraft => ({
  ...EMPTY_DRAFT,
  text: storedThreadDraft(apiUrl, identity, threadId),
})

/**
 * The composer's unsent text and files per conversation, kept in local storage within one verified
 * identity and API scope. The session owns a send once submitted. The draft only hides it meanwhile.
 */
export function useComposerDraft({
  apiUrl,
  verifiedIdentity,
  threadId,
  canLoad,
  debug,
}: {
  apiUrl: string
  /** Undefined while authentication is pending, which keeps the previous identity's drafts. */
  verifiedIdentity: string | undefined
  threadId: string
  canLoad: boolean
  debug: DebugLogger | undefined
}) {
  const [drafts, setDrafts] = useState({
    apiUrl,
    identity: "",
    threads: new Map<string, ThreadDraft>(),
  })
  const identity = verifiedIdentity ?? drafts.identity
  if (drafts.apiUrl !== apiUrl || drafts.identity !== identity)
    setDrafts({ apiUrl, identity, threads: new Map() })
  const draft = drafts.threads.get(threadId) ?? storedDraft(apiUrl, identity, threadId)
  const edits = useRef(new Map<string, number>())
  const editKey = (key: string) => JSON.stringify([apiUrl, identity, key])
  const editCount = (key: string) => edits.current.get(editKey(key)) ?? 0

  // Late uploads, writes, and send callbacks apply only within the scope that started them.
  const edit = useCallback(
    (
      key: string,
      transform: (
        draft: ThreadDraft,
        threads: ReadonlyMap<string, ThreadDraft>,
      ) => ThreadDraft | undefined,
    ) =>
      setDrafts((current) => {
        if (current.apiUrl !== apiUrl || current.identity !== identity) return current
        const value = current.threads.get(key) ?? storedDraft(apiUrl, identity, key)
        const next = transform(value, current.threads)
        if (next === value) return current
        const threads = new Map(current.threads)
        if (next) threads.set(key, next)
        else threads.delete(key)
        return { ...current, threads }
      }),
    [apiUrl, identity],
  )

  useEffect(() => {
    if (!canLoad || draft.attachmentsLoaded) return
    let cancelled = false
    void storedThreadAttachments({ apiUrl, identity, threadId })
      .then(
        (attachments) => ({ attachments, storageError: false }),
        () => ({ attachments: EMPTY_ATTACHMENTS, storageError: true }),
      )
      .then(({ attachments, storageError }) => {
        if (cancelled) return
        edit(threadId, (value) =>
          value.attachmentsLoaded
            ? value
            : {
                ...value,
                attachments,
                settledAttachments: attachments,
                savedAttachments: attachments,
                attachmentsLoaded: true,
                storageError,
              },
        )
      })
    return () => {
      cancelled = true
    }
  }, [apiUrl, identity, threadId, canLoad, draft.attachmentsLoaded, edit])

  // Changes apply by file ID so a stale tab cannot overwrite newer files or restore accepted ones.
  const pendingWrites = useRef(new Set<string>())
  useEffect(() => {
    for (const [key, value] of drafts.threads) {
      if (!value.attachmentsLoaded || value.attachments === value.settledAttachments) continue
      const scope = JSON.stringify([drafts.apiUrl, drafts.identity, key])
      if (pendingWrites.current.has(scope)) continue
      pendingWrites.current.add(scope)
      const finish = (storageError: boolean) => {
        pendingWrites.current.delete(scope)
        edit(key, (latest, threads) =>
          threads.has(key)
            ? {
                ...latest,
                settledAttachments: value.attachments,
                savedAttachments: storageError ? latest.savedAttachments : value.attachments,
                storageError,
              }
            : latest,
        )
      }
      void storedThreadAttachments({
        apiUrl: drafts.apiUrl,
        identity: drafts.identity,
        threadId: key,
        update: (files) => {
          const stored = new Map(files.map((file) => [file.id, file]))
          for (const file of value.savedAttachments) {
            if (!value.attachments.some((current) => current.id === file.id)) stored.delete(file.id)
          }
          for (const file of value.attachments) {
            if (
              file.status === "ready" &&
              !value.savedAttachments.some(
                (saved) => saved.id === file.id && saved.status === "ready",
              )
            )
              stored.set(file.id, file)
          }
          return [...stored.values()]
        },
      }).then(
        () => finish(false),
        () => finish(true),
      )
    }
  }, [drafts, edit])

  const clear = (key: string, keep?: ThreadDraft) => {
    storedThreadDraft(apiUrl, identity, key, "")
    void storedThreadAttachments({ apiUrl, identity, threadId: key, update: () => [] }).catch(
      (error: unknown) => debug?.("error", "Draft files could not be cleared", error),
    )
    edit(key, () => keep)
  }

  // The session keeps these callbacks with its pending send, so a Retry settles the same submission.
  const follow = (submission: Submission, initialKey: string) => {
    let key = initialKey
    return {
      onThreadReady: (id: string) => {
        if (key !== "") return
        key = id
        edits.current.set(editKey(id), editCount(""))
        edits.current.delete(editKey(""))
        const stored = storedThreadDraft(apiUrl, identity, "")
        if (stored) storedThreadDraft(apiUrl, identity, id, stored)
        storedThreadDraft(apiUrl, identity, "", "")
        void storedThreadAttachments({ apiUrl, identity, threadId: "", moveTo: id }).catch(
          (error: unknown) => debug?.("error", "Draft files could not be moved", error),
        )
        edit(id, (value, threads) => {
          const moved = threads.get("")
          const destination = threads.get(id)
          if (!moved) return value
          return {
            ...moved,
            text: moved.text || destination?.text || "",
            attachments: [
              ...new Map(
                [...(destination?.attachments ?? []), ...moved.attachments].map((file) => [
                  file.id,
                  file,
                ]),
              ).values(),
            ],
            settledAttachments: EMPTY_ATTACHMENTS,
            savedAttachments: [...(destination?.savedAttachments ?? []), ...moved.savedAttachments],
          }
        })
        edit("", () => undefined)
      },
      onAccepted: () => {
        if (editCount(key) === submission.edits) storedThreadDraft(apiUrl, identity, key, "")
        void storedThreadAttachments({
          apiUrl,
          identity,
          threadId: key,
          update: (files) => files.filter((file) => !submission.fileIds.has(file.id)),
        }).catch((error: unknown) =>
          debug?.("error", "Accepted draft files could not be cleared", error),
        )
        edit(key, (value) => ({
          ...value,
          attachments: value.attachments.filter((file) => !submission.fileIds.has(file.id)),
          submission: value.submission?.id === submission.id ? undefined : value.submission,
        }))
      },
      /** The session refused the send without keeping it, so an untouched draft gets it back. */
      refused: () => {
        const untouched = editCount(key) === submission.edits
        edit(key, (value) =>
          value.submission?.id === submission.id
            ? { ...value, text: untouched ? submission.text : value.text, submission: undefined }
            : value,
        )
      },
    }
  }

  return {
    identity,
    text: draft.text,
    attachments: draft.submission
      ? draft.attachments.filter((file) => !draft.submission!.fileIds.has(file.id))
      : draft.attachments,
    attachmentsLoaded: draft.attachmentsLoaded,
    /** Attachment changes are still being written to storage. */
    saving: draft.attachments !== draft.settledAttachments,
    storageError: draft.storageError,
    setText: (text: string) => {
      edits.current.set(editKey(threadId), editCount(threadId) + 1)
      storedThreadDraft(apiUrl, identity, threadId, text)
      edit(threadId, (value) => ({ ...value, text }))
    },
    updateAttachments: (update: (attachments: DraftAttachment[]) => DraftAttachment[]) =>
      edit(threadId, (value) => ({ ...value, attachments: update(value.attachments) })),
    /** Applies an upload's outcome in whichever conversation's draft holds the file now. */
    settleAttachment: (id: string, update: Partial<DraftAttachment>) =>
      setDrafts((current) => {
        if (current.apiUrl !== apiUrl || current.identity !== identity) return current
        for (const [key, value] of current.threads) {
          if (!value.attachments.some((file) => file.id === id)) continue
          const attachments = value.attachments.map((file) =>
            file.id === id ? { ...file, ...update } : file,
          )
          return {
            ...current,
            threads: new Map(current.threads).set(key, { ...value, attachments }),
          }
        }
        return current
      }),
    /** Hides the draft as a submission that the session owns from here. */
    submit: (fileIds: ReadonlySet<string>) => {
      const submission = { id: newUuid(), text: draft.text, fileIds, edits: editCount(threadId) }
      edit(threadId, (value) => ({ ...value, text: "", submission }))
      return follow(submission, threadId)
    },
    /** Follows this conversation's unaccepted submission again for a Retry. */
    retry: () => (draft.submission ? follow(draft.submission, threadId) : undefined),
    /** Empties the new-conversation draft, as starting a new chat does. */
    reset: () => clear("", { ...EMPTY_DRAFT, attachmentsLoaded: true }),
    /** Drops a deleted conversation's draft. */
    forget: (id: string) => clear(id),
  }
}
