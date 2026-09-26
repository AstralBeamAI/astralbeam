import { useSyncExternalStore } from "react"
import {
  addIssue,
  dataSchema,
  demoWorkspaces,
  editIssue,
  validateReferences,
  type DemoData,
  type Workspace,
} from "./model.ts"
import { initialData } from "./seed.ts"

export const storageKey = "linearity-demo:v1"
const serverSnapshot = {
  data: initialData("00000000-0000-4000-8000-000000000000"),
  ready: false,
  notice: "",
  generation: 0,
}
let snapshot = serverSnapshot
const listeners = new Set<() => void>()

export function readSavedData(raw: string): DemoData {
  const data = dataSchema.parse(JSON.parse(raw))
  if (new Set(data.workspaces.map((workspace) => workspace.id)).size !== demoWorkspaces.length)
    throw new Error("Invalid workspaces")
  for (const workspace of data.workspaces) {
    if (!demoWorkspaces.some((known) => known.id === workspace.id))
      throw new Error("Unknown workspace")
    if (new Set(workspace.issues.map((issue) => issue.id)).size !== workspace.issues.length)
      throw new Error("Duplicate issues")
    if (workspace.issues.some((issue) => issue.number >= workspace.nextNumber))
      throw new Error("Invalid issue sequence")
    for (const issue of workspace.issues) validateReferences(workspace, issue)
  }
  return data
}
function emit() {
  for (const listener of listeners) listener()
}
function persist(data: DemoData, generation = snapshot.generation) {
  let notice = ""
  try {
    localStorage.setItem(storageKey, JSON.stringify(data))
  } catch {
    notice = "Browser storage is unavailable. Your changes will last until this tab closes."
  }
  snapshot = { data, ready: true, notice, generation }
  emit()
}
function load() {
  let data = initialData(crypto.randomUUID())
  let notice = ""
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) data = readSavedData(saved)
    else localStorage.setItem(storageKey, JSON.stringify(data))
  } catch {
    notice =
      "We couldn't load your saved workspace. This session starts with sample data. Reset to save a fresh copy."
  }
  snapshot = { data, ready: true, notice, generation: snapshot.generation + 1 }
  emit()
}
function onStorage(event: StorageEvent) {
  if (event.key === storageKey || event.key === null) load()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) window.addEventListener("storage", onStorage)
  if (!snapshot.ready) load()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener("storage", onStorage)
  }
}
function currentWorkspace(id: string) {
  if (id !== snapshot.data.activeWorkspaceId)
    throw new Error("The workspace changed. Start a new request in the current workspace.")
  return snapshot.data.workspaces.find((workspace) => workspace.id === id)!
}
function saveWorkspace(workspace: Workspace, text: string, actor: string) {
  const activity = { id: crypto.randomUUID(), text, actor, at: new Date().toISOString() }
  persist({
    ...snapshot.data,
    workspaces: snapshot.data.workspaces.map((entry) =>
      entry.id === workspace.id
        ? { ...workspace, activity: [activity, ...workspace.activity].slice(0, 100) }
        : entry,
    ),
  })
}
export const demoStore = {
  workspace: currentWorkspace,
  create(workspaceId: string, input: unknown, actor = "Avery Chen") {
    const workspace = currentWorkspace(workspaceId)
    const issue = addIssue(workspace, input)
    saveWorkspace(
      { ...workspace, issues: [...workspace.issues, issue], nextNumber: workspace.nextNumber + 1 },
      `Created ${workspace.prefix}-${issue.number}: ${issue.title}`,
      actor,
    )
    return issue
  },
  update(workspaceId: string, id: string, input: unknown, actor = "Avery Chen") {
    const workspace = currentWorkspace(workspaceId)
    const issue = editIssue(workspace, id, input)
    saveWorkspace(
      { ...workspace, issues: workspace.issues.map((entry) => (entry.id === id ? issue : entry)) },
      `Updated ${workspace.prefix}-${issue.number}: ${issue.title} · ${issue.status}`,
      actor,
    )
    return issue
  },
  remove(workspaceId: string, id: string) {
    const workspace = currentWorkspace(workspaceId)
    const issue = workspace.issues.find((entry) => entry.id === id)
    if (!issue) throw new Error("This issue is not in the active workspace")
    saveWorkspace(
      { ...workspace, issues: workspace.issues.filter((entry) => entry.id !== id) },
      `Deleted ${workspace.prefix}-${issue.number}: ${issue.title}`,
      "Avery Chen",
    )
  },
  switchWorkspace(id: string) {
    if (!snapshot.data.workspaces.some((workspace) => workspace.id === id))
      throw new Error("Unknown workspace")
    persist({ ...snapshot.data, activeWorkspaceId: id }, snapshot.generation + 1)
  },
  reset() {
    persist(initialData(snapshot.data.visitorId), snapshot.generation + 1)
  },
}
export function useDemo() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => serverSnapshot,
  )
}
