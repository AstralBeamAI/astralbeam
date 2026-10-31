import type { Argv } from "yargs"
export type { InferArgs } from "./generated/_runtime/cli-types.ts"

export interface CommonYargsOptions {
  json: boolean
  debug: boolean
}

export type Cli = Argv<CommonYargsOptions>

export class UsageError extends Error {}

/** A token lifetime, within the 60-600 seconds the API accepts. */
export function lifetimeSeconds(value: number): number {
  if (!Number.isInteger(value) || value < 60 || value > 600) {
    throw new UsageError("Expected a whole number of seconds from 60 to 600.")
  }
  return value
}
