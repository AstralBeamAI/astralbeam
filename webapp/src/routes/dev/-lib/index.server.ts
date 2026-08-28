import "@tanstack/react-start/server-only"

import {
  developmentRouteResponseHeaders,
  escapeDevelopmentRouteHtml,
  handleDevelopmentRouteRequest,
  renderDevelopmentRouteDocument,
} from "./http.server.ts"

const DEVELOPMENT_UTILITY_DEFINITIONS = [
  {
    description: "Render transactional email components with synthetic fixture props.",
    href: "/dev/emails",
    name: "Email previews",
  },
] as const

function renderDevelopmentIndexHtml(): string {
  const utilityItems = DEVELOPMENT_UTILITY_DEFINITIONS.map((utility) =>
    `<li class="tool"><a href="${escapeDevelopmentRouteHtml(utility.href)}"><strong>${
      escapeDevelopmentRouteHtml(utility.name)
    }</strong></a><p>${escapeDevelopmentRouteHtml(utility.description)}</p></li>`
  ).join("")

  return renderDevelopmentRouteDocument({
    bodyHtml: `<ul class="tools">${utilityItems}</ul>`,
    description: "Local utilities mounted by the application during development.",
    heading: "Development tools",
    title: "Development tools",
  })
}

export function handleDevelopmentIndexRequest(request: Request): Promise<Response> {
  return handleDevelopmentRouteRequest(
    request,
    () =>
      new Response(renderDevelopmentIndexHtml(), {
        headers: developmentRouteResponseHeaders("text/html; charset=utf-8"),
      }),
  )
}
