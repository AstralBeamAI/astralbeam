export function readClusterConfiguration(environment: Record<string, string | undefined>) {
  const webappPort = Number(
    environment.NODE_ENV === "development"
      ? (environment.PORT ?? 4500)
      : (environment.NITRO_PORT ?? environment.PORT ?? 3000),
  )
  const port =
    environment.CLUSTER_PORT === undefined ? webappPort - 1 : Number(environment.CLUSTER_PORT)
  const host = environment.CLUSTER_HOST ?? "127.0.0.1"
  const listenHost = environment.CLUSTER_LISTEN_HOST ?? "127.0.0.1"
  if (
    (environment.CLUSTER_PORT === undefined &&
      (!Number.isInteger(webappPort) || webappPort < 2 || webappPort > 65535)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    environment.CLUSTER_PORT?.trim() === "" ||
    !host.trim() ||
    !listenHost.trim() ||
    host === "0.0.0.0" ||
    host === "::"
  ) {
    throw new Error("Invalid CLUSTER_HOST, CLUSTER_PORT, or CLUSTER_LISTEN_HOST")
  }
  return { host, port, listenHost }
}
