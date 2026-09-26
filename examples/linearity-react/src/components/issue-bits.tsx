import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  CircleIcon,
  DotsThreeIcon,
  FlagIcon,
  MinusIcon,
  CellSignalHighIcon,
  CellSignalLowIcon,
  CellSignalMediumIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import type { Issue, Member } from "@/lib/model.ts"

export function Avatar({ member, small = false }: { member: Member | undefined; small?: boolean }) {
  return (
    <span
      className={`avatar ${member?.color ?? "neutral"} ${small ? "small" : ""}`}
      title={member?.name ?? "Unassigned"}
      aria-label={member?.name ?? "Unassigned"}
    >
      {member?.initials ?? "–"}
    </span>
  )
}
export function StatusIcon({ status }: { status: Issue["status"] }) {
  const Icon = {
    Backlog: CircleDashedIcon,
    Todo: CircleIcon,
    "In progress": CircleHalfIcon,
    "In review": CircleHalfIcon,
    Done: CheckCircleIcon,
    Canceled: XCircleIcon,
  }[status]
  return (
    <Icon
      size={16}
      weight={status === "Done" ? "fill" : "regular"}
      className={`status-icon status-${status.toLowerCase().replaceAll(" ", "-")}`}
      aria-label={status}
    />
  )
}
export function PriorityIcon({ priority }: { priority: Issue["priority"] }) {
  const Icon =
    {
      Urgent: FlagIcon,
      High: CellSignalHighIcon,
      Medium: CellSignalMediumIcon,
      Low: CellSignalLowIcon,
      None: MinusIcon,
    }[priority] ?? DotsThreeIcon
  return (
    <span className={`priority priority-${priority.toLowerCase()}`} title={`${priority} priority`}>
      <Icon
        size={16}
        aria-label={`${priority} priority`}
        weight={priority === "Urgent" ? "fill" : "bold"}
      />
    </span>
  )
}
