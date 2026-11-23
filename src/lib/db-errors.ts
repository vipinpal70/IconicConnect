/**
 * Reading Postgres errors. Drizzle wraps driver errors ("Failed query: …") and keeps the original on
 * `cause`, so checking only the top-level `code` misses every error that came through a query. These
 * helpers look down the cause chain.
 */

interface PgErrorFields {
  code?: string
  constraint_name?: string
}

/** The Postgres error inside `error`, however deeply it is wrapped (or null). */
export function pgErrorOf(error: unknown): PgErrorFields | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const fields = current as PgErrorFields & { cause?: unknown }
    if (typeof fields.code === 'string' && /^[0-9A-Z]{5}$/.test(fields.code)) return fields
    current = fields.cause
  }
  return null
}

/**
 * A unique-constraint violation (SQLSTATE 23505). Pass `constraint` to match one specific constraint or
 * unique index, so a clash on another column isn't misreported (e.g. a lab name as an email).
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgErrorOf(error)
  if (pg?.code !== '23505') return false
  return constraint === undefined || pg.constraint_name === constraint
}
