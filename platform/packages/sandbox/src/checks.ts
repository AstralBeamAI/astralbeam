import type { SandboxHandle, SandboxProvider } from "@tanstack/ai-sandbox"

type CheckAction = "create-sandbox" | "execute-test" | "destroy-sandbox"
type CheckOptions = { signal?: AbortSignal }

export class SandboxConnection {
  private resolved?: Promise<SandboxProvider>

  constructor(private readonly initialize: () => SandboxProvider | Promise<SandboxProvider>) {}

  static available(): Promise<boolean> {
    return Promise.resolve(true)
  }

  get provider(): Promise<SandboxProvider> {
    return (this.resolved ??= Promise.resolve().then(this.initialize))
  }

  async valid(options: CheckOptions = {}): Promise<true> {
    await testSandboxConnection(await this.provider, options)
    return true
  }
}

export class SandboxCheckError extends Error {
  constructor(
    readonly action: CheckAction,
    cause: unknown,
  ) {
    super("Sandbox connection check failed", { cause })
    this.name = "SandboxCheckError"
  }
}

async function sandboxCheckOperation<A>(
  action: CheckAction,
  operation: (signal: AbortSignal) => Promise<A>,
  timeout: number,
  parent?: AbortSignal,
): Promise<A> {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException("Sandbox check timed out", "TimeoutError")),
    timeout,
  )
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal
  const aborted = Promise.withResolvers<never>()
  const abort = () => aborted.reject(signal.reason)
  signal.addEventListener("abort", abort, { once: true })
  try {
    signal.throwIfAborted()
    return await Promise.race([operation(signal), aborted.promise])
  } catch (cause) {
    throw new SandboxCheckError(action, cause)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", abort)
  }
}

async function testSandboxConnection(
  provider: SandboxProvider,
  options: CheckOptions = {},
): Promise<void> {
  let pending: Promise<SandboxHandle> | undefined
  let handle: SandboxHandle
  try {
    handle = await sandboxCheckOperation(
      "create-sandbox",
      (signal) => (pending = provider.create({ signal })),
      120_000,
      options.signal,
    )
  } catch (error) {
    // Some adapters ignore cancellation and finish creating after the check has ended.
    void pending?.then((late) => late.destroy()).catch(() => undefined)
    throw error
  }
  try {
    await sandboxCheckOperation(
      "execute-test",
      async (signal) => {
        const result = await handle.process.exec("printf sandbox-connection-ok", { signal })
        if (result.exitCode !== 0 || result.stdout !== "sandbox-connection-ok")
          throw new Error("Sandbox connection command failed")
      },
      15_000,
      options.signal,
    )
  } finally {
    // Cleanup must still run after caller cancellation, with its own deadline.
    await sandboxCheckOperation("destroy-sandbox", () => handle.destroy(), 15_000)
  }
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    const { default: Dockerode } = await import("dockerode")
    const docker = new Dockerode()
    // Remove this assertion when Dockerode's ping typings accept request options.
    // https://github.com/apocas/dockerode/blob/v5.0.1/lib/docker.js#L1397
    const ping = docker.ping.bind(docker) as (options: {
      abortSignal: AbortSignal
    }) => Promise<unknown>
    return String(await ping({ abortSignal: AbortSignal.timeout(1_000) })) === "OK"
  } catch {
    return false
  }
}
