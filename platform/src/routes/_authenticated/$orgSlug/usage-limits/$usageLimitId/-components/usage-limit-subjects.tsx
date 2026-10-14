import { Link } from "@tanstack/react-router"

import { LocalDateTime } from "@/components/local-date-time"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { USAGE_LIMIT_SUBJECTS_PAGE_SIZE } from "@/lib/usage-limits/schemas"
import type { UsageLimit, UsageLimitSubjectUsage } from "@/lib/usage-limits/usage-limits.server"
import { formatUsageLimitAmount } from "../../-lib/utils"

const subjectHeadings: Record<UsageLimit["scope"], string> = {
  global: "Organization",
  tenant: "Tenant",
  tenant_user: "Tenant user",
  thread: "Conversation",
}

function subjectLabel(scope: UsageLimit["scope"], subject: UsageLimitSubjectUsage) {
  const tenantName = subject.tenant && (subject.tenant.name ?? subject.tenant.externalId)
  if (scope === "global") return { primary: "All usage", secondary: null }
  if (scope === "tenant") return { primary: tenantName, secondary: null }
  if (scope === "tenant_user")
    return {
      primary: subject.tenantUser && (subject.tenantUser.name ?? subject.tenantUser.externalId),
      secondary: tenantName,
    }
  return { primary: subject.threadTitle || "Untitled conversation", secondary: tenantName }
}

/** Ranks the subjects of a limit by their usage in their current windows, most used first. */
export function UsageLimitSubjects({
  organizationSlug,
  usageLimit,
  usage,
  page,
}: {
  organizationSlug: string
  usageLimit: UsageLimit
  usage: { subjects: readonly UsageLimitSubjectUsage[]; total: number }
  page: number
}) {
  const first = (page - 1) * USAGE_LIMIT_SUBJECTS_PAGE_SIZE + 1
  const last = first + usage.subjects.length - 1
  const pageLink = (target: number) => ({
    to: "/$orgSlug/usage-limits/$usageLimitId" as const,
    params: { orgSlug: organizationSlug, usageLimitId: usageLimit.id },
    search: target > 1 ? { page: target } : {},
  })

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>
          {subjectHeadings[usageLimit.scope]}s with usage in their current window, most used first.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {usage.subjects.length === 0 ? (
          <p className="px-(--card-padding,1rem) text-sm text-muted-foreground">
            No usage in the current window yet.
          </p>
        ) : (
          <Table aria-label="Usage by subject">
            <TableHeader>
              <TableRow>
                <TableHead>{subjectHeadings[usageLimit.scope]}</TableHead>
                <TableHead className="text-end">Used</TableHead>
                <TableHead className="w-40">Of limit</TableHead>
                <TableHead>Resets</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.subjects.map((subject) => {
                const label = subjectLabel(usageLimit.scope, subject)
                const share = Math.min(1, Number(subject.used) / Number(usageLimit.amount))
                return (
                  <TableRow key={subject.id}>
                    <TableCell>
                      <div className="font-medium">{label.primary}</div>
                      {label.secondary && (
                        <div className="text-muted-foreground">{label.secondary}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatUsageLimitAmount({ metric: usageLimit.metric, amount: subject.used })}
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex items-center gap-2"
                        title={`${Math.round(share * 100)}% of ${formatUsageLimitAmount(usageLimit)}`}
                      >
                        <div className="h-1.5 flex-1 bg-muted">
                          <div
                            className={share >= 1 ? "h-full bg-destructive" : "h-full bg-primary"}
                            style={{ width: `${share * 100}%` }}
                          />
                        </div>
                        <span className="w-9 text-end tabular-nums text-muted-foreground">
                          {Math.round(share * 100)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <LocalDateTime value={subject.resetsAt} dateStyle="medium" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {usage.total > USAGE_LIMIT_SUBJECTS_PAGE_SIZE && (
        <CardFooter className="justify-between gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {first}–{last} of {usage.total}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link {...pageLink(page - 1)} className={buttonVariants({ variant: "outline" })}>
                Previous
              </Link>
            )}
            {last < usage.total && (
              <Link {...pageLink(page + 1)} className={buttonVariants({ variant: "outline" })}>
                Next
              </Link>
            )}
          </div>
        </CardFooter>
      )}
    </Card>
  )
}
