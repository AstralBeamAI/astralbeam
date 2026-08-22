// tsconfig.json declares only ES2025 and DOM libs, so the Deno namespace is pulled in per file.
/// <reference lib="deno.ns" />
import { readdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { createElement } from "react"
import type { ComponentType } from "react"
import { render } from "react-email"

const templatesDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "emails",
  "templates",
)

const port = Number(process.env.PORT ?? "3002")

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`PORT must be a positive integer; received ${process.env.PORT}`)
}

interface TemplateModule {
  default: ComponentType<Record<string, unknown>> & { PreviewProps?: Record<string, unknown> }
}

async function listTemplateNames() {
  const entries = await readdir(templatesDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => entry.name.slice(0, -".tsx".length))
    .toSorted()
}

async function renderTemplate(name: string, plainText: boolean) {
  const path = join(templatesDirectory, `${name}.tsx`)
  // Bust Deno's module cache with the file's mtime so edits show up on reload without a restart.
  const { mtimeMs } = await stat(path)
  const module: TemplateModule = await import(`${path}?mtime=${mtimeMs}`)
  const Template = module.default

  if (typeof Template !== "function") {
    throw new Error(`'${name}.tsx' must default-export a template component`)
  }

  // `render` discriminates its options on a literal `plainText`, so a boolean variable cannot be
  // forwarded as one argument.
  const element = createElement(Template, Template.PreviewProps ?? {})
  return plainText ? await render(element, { plainText: true }) : await render(element)
}

function renderIndex(names: string[]) {
  const items = names
    .map((name) =>
      `<li><a href="/${name}">${name}</a> <a href="/${name}?text=1" class="text">plain text</a></li>`
    )
    .join("")
  return `<!doctype html><meta charset="utf-8"><title>Email previews</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 3rem auto; max-width: 40rem; }
  li { margin-block: 0.5rem; }
  .text { color: #6b7280; font-size: 0.8rem; margin-inline-start: 0.5rem; }
</style>
<h1>Email previews</h1>
${names.length > 0 ? `<ul>${items}</ul>` : "<p>No templates found.</p>"}`
}

Deno.serve({ port }, async (request) => {
  const url = new URL(request.url)
  const name = url.pathname.slice(1)

  try {
    const names = await listTemplateNames()

    if (name === "") {
      return new Response(renderIndex(names), {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    }

    if (!names.includes(name)) {
      return new Response(`Unknown template '${name}'`, { status: 404 })
    }

    const plainText = url.searchParams.has("text")
    return new Response(await renderTemplate(name, plainText), {
      headers: {
        "content-type": plainText ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
      },
    })
  } catch (error) {
    console.error(error)
    const message = error instanceof Error ? error.message : String(error)
    return new Response(`Failed to render '${name}': ${message}`, { status: 500 })
  }
})
