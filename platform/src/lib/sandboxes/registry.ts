import { SANDBOX_PROVIDER_IDS, type SandboxProviderId } from "./schemas.ts"

export type SandboxProviderDescriptor = {
  id: SandboxProviderId
  label: string
  setupUrl: string
  credentialLabel: string | null
}

const SANDBOX_PROVIDER_DESCRIPTORS = {
  daytona: {
    id: "daytona",
    label: "Daytona",
    setupUrl: "https://www.daytona.io/docs/api-keys/",
    credentialLabel: "API key",
  },
  docker: {
    id: "docker",
    label: "Docker",
    setupUrl: "https://docs.docker.com/engine/install/",
    credentialLabel: null,
  },
  e2b: {
    id: "e2b",
    label: "E2B",
    setupUrl: "https://e2b.dev/docs/quickstart",
    credentialLabel: "API key",
  },
  sprites: {
    id: "sprites",
    label: "Sprites",
    setupUrl: "https://docs.sprites.dev/cli/authentication/",
    credentialLabel: "API token",
  },
  vercel: {
    id: "vercel",
    label: "Vercel",
    setupUrl: "https://vercel.com/docs/sandbox",
    credentialLabel: "Access token",
  },
} as const satisfies Record<SandboxProviderId, SandboxProviderDescriptor>

export const sandboxProviderDescriptors: SandboxProviderDescriptor[] = SANDBOX_PROVIDER_IDS.map(
  (id) => SANDBOX_PROVIDER_DESCRIPTORS[id],
)
