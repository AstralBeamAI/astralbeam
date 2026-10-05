import { useState } from "react"
import { CircleNotchIcon, PlusIcon, TrashIcon, UserGearIcon } from "@phosphor-icons/react"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import { Button } from "./ui/button.tsx"
import { TenantUserSearch, type TenantUserChoice } from "./tenant-user-search.tsx"
import { SearchDropdown } from "./search-dropdown.tsx"
import { TenantUserLabel } from "./tenant-user-label.tsx"

const roles = [
  { id: "viewer", label: "Viewer" },
  { id: "member", label: "Member" },
  { id: "manager", label: "Manager" },
] as const

export function ThreadParticipants({
  chat,
  state,
}: {
  chat: AstralBeamChatCore
  state: AstralBeamChatState
}) {
  const [open, setOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<TenantUserChoice | null>(null)
  const [saving, setSaving] = useState(false)
  const [role, setRole] = useState<"viewer" | "member" | "manager">("member")
  const managers = state.participants.filter((participant) => participant.role === "manager").length
  const addParticipant = async () => {
    if (!selectedUser || saving) return
    setSaving(true)
    try {
      await chat.setParticipant(selectedUser.id, role)
      if (
        chat
          .getState()
          .participants.some((participant) => participant.tenantUserId === selectedUser.id)
      )
        setSelectedUser(null)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="contents">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Manage conversation access"
        title="Manage conversation access"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          if (!open) void chat.listParticipants()
        }}
      >
        <UserGearIcon />
      </Button>
      {open && (
        <div className="flex w-full flex-col gap-2 pt-2">
          <p className="text-xs text-muted-foreground">
            Add someone from your Tenant. Viewers read, members can reply, and managers can share
            and delete.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_2rem] items-center gap-2">
            <form
              className="contents"
              onSubmit={(event) => {
                event.preventDefault()
                void addParticipant()
              }}
            >
              <TenantUserSearch
                loadPage={chat.searchTenantUsers}
                value={selectedUser}
                onValueChange={setSelectedUser}
                disabled={saving}
              />
              <SearchDropdown
                className="w-full"
                label="Participant role"
                items={roles}
                value={roles.find((item) => item.id === role)!}
                itemLabel={(item) => item.label}
                onValueChange={(item) => {
                  if (item) setRole(item.id)
                }}
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Add participant"
                title={saving ? "Adding participant…" : "Add participant"}
                disabled={!selectedUser || saving}
              >
                {saving ? <CircleNotchIcon className="animate-spin" /> : <PlusIcon />}
              </Button>
            </form>
            {state.participants.map((participant) => {
              const lastManager = participant.role === "manager" && managers === 1
              const removeTitle = lastManager
                ? "At least one manager is required"
                : `Remove ${participant.name || participant.externalId}`
              return (
                <div key={participant.tenantUserId} className="contents text-xs">
                  <TenantUserLabel
                    name={participant.name}
                    externalId={participant.externalId}
                    email={participant.email}
                  />
                  <SearchDropdown
                    className="w-full"
                    label={`Role for ${participant.name || participant.externalId}`}
                    items={roles}
                    value={roles.find((item) => item.id === participant.role)!}
                    itemLabel={(item) => item.label}
                    itemDisabled={(item) => lastManager && item.id !== "manager"}
                    onValueChange={(item) => {
                      if (item) void chat.setParticipant(participant.tenantUserId, item.id)
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="disabled:pointer-events-auto"
                    aria-label={`Remove ${participant.name || participant.externalId}`}
                    title={removeTitle}
                    disabled={lastManager}
                    onClick={() => void chat.removeParticipant(participant.tenantUserId)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
