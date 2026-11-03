export function worktreeHash(seed: string): number {
  // FNV-1a keeps suite ports stable without another dependency.
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}
