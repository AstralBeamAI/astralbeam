export const OPERATOR_SESSION_COOKIE = "operator_session"
// Operator sessions are deliberately short: they hold database-credential-level access to every
// runtime setting, so they expire outright rather than sliding on activity.
export const OPERATOR_SESSION_TTL_SECONDS = 20 * 60
export const MIGRATION_ADVISORY_LOCK_KEY = "config_migrations"
