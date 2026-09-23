import { expect, test } from "vitest"
import { readClusterConfiguration } from "./config.server.ts"

test.each([
  [{ NODE_ENV: "development" }, 4499],
  [{ NODE_ENV: "production" }, 2999],
  [{ PORT: "4600" }, 4599],
  [{ NODE_ENV: "production", PORT: "4600", NITRO_PORT: "4700" }, 4699],
  [{ NODE_ENV: "development", PORT: "4600", NITRO_PORT: "4700" }, 4599],
  [{ PORT: "65535" }, 65534],
  [{ PORT: "2" }, 1],
  [{ PORT: "0", CLUSTER_PORT: "4800" }, 4800],
])("derives the cluster port from server settings %o", (environment, port) => {
  expect(readClusterConfiguration(environment).port).toBe(port)
})

test.each([{ PORT: "0" }, { PORT: "1" }, { PORT: "65536" }, { CLUSTER_PORT: "0" }])(
  "rejects ports that cannot identify a runner %o",
  (environment) => {
    expect(() => readClusterConfiguration(environment)).toThrow("Invalid")
  },
)
