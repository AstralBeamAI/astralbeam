import { sqlState } from "@/db/lib/sqlstate.server"

export async function withConfigureError<Value>(
  message: string,
  operation: () => PromiseLike<Value>,
): Promise<Value> {
  try {
    return await operation()
  } catch (error) {
    // Error messages can contain submitted secrets or SQL parameters; classifications and
    // PostgreSQL codes are enough to correlate failures without retaining sensitive values.
    console.error(message, {
      type: error instanceof Error ? error.name : typeof error,
      code: sqlState(error),
    })
    throw new Error(message)
  }
}
