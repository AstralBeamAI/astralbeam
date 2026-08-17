import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"

import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Keep SSR-hydrated queries fresh briefly so hydration does not immediately refetch them. https://tanstack.com/query/latest/docs/framework/react/guides/ssr
        staleTime: 2 * 60 * 1000,
      },
    },
  })

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    // Let TanStack Query own freshness while Router continues to invoke route loaders during preloads. https://tanstack.com/router/latest/docs/guide/preloading#preloading-with-external-libraries
    defaultPreloadStaleTime: 0,
  })

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
