import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { McpPolicy } from "@/lib/mcp/schemas"

export function McpPolicyForm({
  policy,
  busy,
  save,
}: {
  policy: McpPolicy
  busy: boolean
  save: (policy: McpPolicy) => void
}) {
  return (
    <form
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        save({
          ...policy,
          allowTenantMcpServers: fields.has("tenants"),
          allowTenantUserMcpServers: fields.has("users"),
        })
      }}
    >
      <Label>
        <input
          type="checkbox"
          name="tenants"
          disabled={busy}
          defaultChecked={policy.allowTenantMcpServers}
        />{" "}
        Allow Tenants to add shared servers
      </Label>
      <Label>
        <input
          type="checkbox"
          name="users"
          disabled={busy}
          defaultChecked={policy.allowTenantUserMcpServers}
        />{" "}
        Allow Tenant users to add personal servers
      </Label>
      <p className="text-sm text-muted-foreground">
        Disabling an option immediately blocks existing custom servers. Accounts are retained, and
        Organization defaults remain available.
      </p>
      <Button className="w-fit" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save permissions"}
      </Button>
    </form>
  )
}
