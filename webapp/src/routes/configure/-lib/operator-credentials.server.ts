import { createHash, timingSafeEqual } from "node:crypto"

import { getActiveDatabaseEncryptionRoot } from "@/db/lib/database-credentials.server"

function digestCredential(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

export function checkOperatorKey(
  value: string,
  activeKey = getActiveDatabaseEncryptionRoot(),
): boolean {
  return timingSafeEqual(digestCredential(value.trim()), activeKey)
}
