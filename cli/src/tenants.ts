import {
  createTenant,
  getTenant,
  listTenants,
  updateTenant,
  type UpdateTenantInput,
} from "@astralbeam/sdk/api"
import { type Command, Option } from "commander"
import { apiOptions, globalOptions } from "./config.ts"
import { addListOptions, type ListOptions, listPages, listParams, printPage } from "./listing.ts"
import { jsonObject } from "./options.ts"
import { printResult } from "./output.ts"

export interface RecordWriteOptions {
  name?: string
  clearName?: boolean
  metadata?: Record<string, unknown>
}

/** The shared Tenant and TenantUser fields, with omitted options left out of the body. */
export function recordWriteInput(options: RecordWriteOptions): UpdateTenantInput {
  const input: UpdateTenantInput = {}
  if (options.name !== undefined) input.name = options.name
  if (options.clearName) input.name = null
  if (options.metadata !== undefined) input.metadata = options.metadata
  return input
}

/** Adds --name, --clear-name (update only), and --metadata. */
export function addRecordWriteOptions(command: Command, update: boolean): Command {
  command.option("--name <name>", "display name")
  if (update) command.addOption(new Option("--clear-name", "remove the name").conflicts("name"))
  return command.option(
    "--metadata <json>",
    update ? "JSON object replacing the stored metadata" : "JSON object stored with the record",
    jsonObject,
  )
}

export function registerTenantCommands(program: Command): void {
  const tenants = program
    .command("tenants")
    .description("Manage Tenants, the customers of your application")

  addListOptions(tenants.command("list").description("List Tenants in internal ID order")).action(
    async (options: ListOptions, command: Command) => {
      const api = await apiOptions(command)
      const page = await listPages(listParams(options), options.all, (params) =>
        listTenants(params, api),
      )
      printPage(page, ["id", "external_id", "name", "created_at"], globalOptions(command).json)
    },
  )

  tenants
    .command("get")
    .description("Show one Tenant by its internal ID")
    .argument("<id>", "internal Tenant ID")
    .action(async (id: string, _options: object, command: Command) => {
      printResult(await getTenant(id, await apiOptions(command)), globalOptions(command).json)
    })

  addRecordWriteOptions(
    tenants
      .command("create")
      .description("Create a Tenant. An external ID already in use returns HTTP 409.")
      .requiredOption("--external-id <id>", "your stable, immutable identity for the customer"),
    false,
  ).action(async (options: RecordWriteOptions & { externalId: string }, command: Command) => {
    const input = { external_id: options.externalId, ...recordWriteInput(options) }
    printResult(await createTenant(input, await apiOptions(command)), globalOptions(command).json)
  })

  addRecordWriteOptions(
    tenants
      .command("update")
      .description("Update a Tenant. Omitted fields stay unchanged.")
      .argument("<id>", "internal Tenant ID"),
    true,
  ).action(async (id: string, options: RecordWriteOptions, command: Command) => {
    const input = recordWriteInput(options)
    if (Object.keys(input).length === 0) command.error("Pass --name, --clear-name, or --metadata.")
    printResult(
      await updateTenant(id, input, await apiOptions(command)),
      globalOptions(command).json,
    )
  })
}
