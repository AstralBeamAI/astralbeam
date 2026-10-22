export async function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const cancelled = Promise.withResolvers<never>()
  const abort = () => cancelled.reject(signal.reason)
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()
  try {
    return await Promise.race([promise, cancelled.promise])
  } finally {
    signal.removeEventListener("abort", abort)
  }
}
