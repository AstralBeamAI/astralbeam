export function tenantUserIdentifier(value: string): string {
  return /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)
    ? `...${value.slice(-7).toLowerCase()}`
    : value
}

export function TenantUserLabel({
  name,
  externalId,
  email,
}: {
  name: string | null
  externalId: string
  email: string | null
}) {
  const identifier = email || tenantUserIdentifier(externalId)
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-1"
      title={name ? `${name} (${email || externalId})` : email || externalId}
    >
      {name && <span className="min-w-0 flex-1 truncate">{name}</span>}
      <span
        className={
          name && !email && identifier !== externalId
            ? "shrink-0 text-xs text-muted-foreground"
            : "min-w-0 flex-1 truncate text-xs text-muted-foreground"
        }
      >
        {identifier}
      </span>
    </span>
  )
}
