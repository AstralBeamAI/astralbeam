type MigrationApproval = { readonly name: string; readonly hash: string }

export function approvedMigrationsMatch(
  pending: readonly MigrationApproval[],
  approved: readonly MigrationApproval[],
): boolean {
  return pending.length === approved.length &&
    pending.every((migration, index) => {
      const approval = approved[index]
      return approval?.name === migration.name && approval.hash === migration.hash
    })
}
