import {
  spritesSandbox,
  SpritesClient,
  SpritesHandle,
  type SpritesSandboxConfig,
} from "@tanstack/ai-sandbox-sprites"
import process from "node:process"
import { SandboxConnection } from "./checks.ts"
import { sandboxLifecycle } from "./lifecycle.ts"

export class SpritesSandbox extends SandboxConnection {
  constructor(config: SpritesSandboxConfig) {
    super(() => {
      const apiKey = config.apiKey ?? process.env.SPRITES_API_KEY
      if (!apiKey) throw new Error("Sprites API key is required")
      const apiUrl = config.apiUrl ?? process.env.SPRITES_API_URL
      const client = new SpritesClient({ apiKey, ...(apiUrl ? { baseUrl: apiUrl } : {}) })
      return sandboxLifecycle(spritesSandbox(config), {
        resume: async ({ id, signal }) => {
          try {
            const sprite = await client.getSprite(id, signal)
            return new SpritesHandle({
              client,
              name: sprite.name,
              url: sprite.url,
              workdir: config.workdir ?? "/home/sprite",
              httpPort: config.httpPort ?? 8080,
              urlAuth: config.urlAuth ?? "public",
            })
          } catch (error) {
            if (error instanceof Error && / failed: 404 /.test(error.message)) return null
            throw error
          }
        },
      })
    })
  }
}
