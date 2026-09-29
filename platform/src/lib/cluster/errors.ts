import { Schema } from "effect"

/** The local runner is not ready, so no workflow can be submitted yet. */
export class ClusterUnavailableError extends Schema.TaggedError<ClusterUnavailableError>()(
  "ClusterUnavailableError",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "Background jobs are unavailable. Try again shortly."
}

/** `CLUSTER_RUNNER_*` would bind outside 0 to 65535 or advertise a wildcard host. */
export class ClusterRunnerSettingsInvalid extends Schema.TaggedError<ClusterRunnerSettingsInvalid>()(
  "ClusterRunnerSettingsInvalid",
  {},
) {
  override readonly message =
    "CLUSTER_RUNNER_PORT must be 0 to 65535 and CLUSTER_RUNNER_HOST a reachable, non-wildcard host"
}
