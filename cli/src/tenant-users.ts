import {
  createTenantUser,
  getTenantUser,
  listUsersForTenant,
  type ListUsersForTenantParams,
  updateTenantUser,
  type UpdateTenantUserInput,
} from "@astralbeam/sdk/api"
import { type Command, Option } from "commander"
import { apiOptions, globalOptions } from "./config.ts"
import { addListOptions, type ListOptions, listPages, listParams, printPage } from "./listing.ts"
import { printResult } from "./output.ts"
import { addRecordWriteOptions, type RecordWriteOptions, recordWriteInput } from "./tenants.ts"

type TenantUserWriteOptions = RecordWriteOptions & { admin?: boolean }

function tenantUserWriteInput(options: TenantUserWriteOptions): UpdateTenantUserInput {
  const input: UpdateTenantUserInput = recordWriteInput(options)
  if (options.admin !== undefined) input.admin = options.admin
  return input
}

// `--admin` and `--no-admin` together make a tri-state: true, false, or omitted.
function addAdminOptions(command: Command, description: string): Command {
  return command
    .addOption(new Option("--admin", description))
    .addOption(new Option("--no-admin", "the opposite of --admin"))
}

export function registerTenantUserCommands(program: Command): void {
  const tenantUsers = program
    .command("tenant-users")
    .description("Manage TenantUsers, the users of one Tenant")

  addAdminOptions(
    addListOptions(
      tenantUsers
        .command("list")
        .description("List a Tenant's users in internal ID order")
        .argument("<tenant-id>", "internal Tenant ID"),
    ),
    "only stored admins (--no-admin: only non-admins)",
  ).action(
    async (tenantId: string, options: ListOptions & { admin?: boolean }, command: Command) => {
      const api = await apiOptions()
      const params: ListUsersForTenantParams = listParams(options)
      if (options.admin !== undefined) params["filter[admin]"] = options.admin ? "true" : "false"
      const page = await listPages(params, options.all, (pageParams) =>
        listUsersForTenant(tenantId, pageParams, api),
      )
      const columns = ["id", "external_id", "name", "admin", "created_at"]
      printPage(page, columns, globalOptions(command).json)
    },
  )

  tenantUsers
    .command("get")
    .description("Show one TenantUser by its internal ID")
    .argument("<tenant-id>", "internal Tenant ID")
    .argument("<id>", "internal TenantUser ID")
    .action(async (tenantId: string, id: string, _options: object, command: Command) => {
      const user = await getTenantUser(tenantId, id, await apiOptions())
      printResult(user, globalOptions(command).json)
    })

  addAdminOptions(
    addRecordWriteOptions(
      tenantUsers
        .command("create")
        .description("Create a TenantUser. An external ID already in the Tenant returns HTTP 409.")
        .argument("<tenant-id>", "internal Tenant ID")
        .requiredOption("--external-id <id>", "your stable, immutable identity for the user"),
      false,
    ),
    "store the user as a Tenant admin (default false)",
  ).action(
    async (
      tenantId: string,
      options: TenantUserWriteOptions & { externalId: string },
      command: Command,
    ) => {
      const input = { external_id: options.externalId, ...tenantUserWriteInput(options) }
      const user = await createTenantUser(tenantId, input, await apiOptions())
      printResult(user, globalOptions(command).json)
    },
  )

  addAdminOptions(
    addRecordWriteOptions(
      tenantUsers
        .command("update")
        .description("Update a TenantUser. Omitted fields stay unchanged.")
        .argument("<tenant-id>", "internal Tenant ID")
        .argument("<id>", "internal TenantUser ID"),
      true,
    ),
    "store the user as a Tenant admin",
  ).action(
    async (tenantId: string, id: string, options: TenantUserWriteOptions, command: Command) => {
      const input = tenantUserWriteInput(options)
      if (Object.keys(input).length === 0) {
        command.error("Pass --name, --clear-name, --metadata, --admin, or --no-admin.")
      }
      const user = await updateTenantUser(tenantId, id, input, await apiOptions())
      printResult(user, globalOptions(command).json)
    },
  )
}
