import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * What the journey leaves behind so a focused spec can start from a configured deployment with an
 * organization already in it, instead of inheriting an unwritten ordering contract.
 */
export type Baseline = {
  email: string
  password: string
  organizationName: string
  organizationSlug: string
}

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), ".output")
const baselinePath = join(outputDirectory, "baseline.json")

/** The signed-in owner's cookies, which `playwright.config.ts` gives the feature project. */
export const baselineStatePath = join(outputDirectory, "baseline-state.json")

export function writeBaseline(baseline: Baseline): void {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2))
}

export function readBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline
  } catch {
    throw new Error(
      "No baseline was written. The `journey` project establishes it, and every feature spec depends on it.",
    )
  }
}
