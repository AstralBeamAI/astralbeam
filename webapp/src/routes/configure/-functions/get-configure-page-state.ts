import { createServerFn } from "@tanstack/react-start"

export const getConfigurePageState = createServerFn({ method: "GET" }).handler(async () =>
  (await import("./get-configure-page-state.server")).loadConfigurePageState()
)
