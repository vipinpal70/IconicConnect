/**
 * Drizzle wraps the driver error in "Failed query: <sql> params: <values>", which (a) hides the actual Postgres
 * reason one level down in `cause` and (b) prints bound parameters (user ids, emails…) into the logs.
 * This pulls out only what you need to diagnose an incident: SQLSTATE code, Postgres' own message, and the
 * table/column/constraint involved — never the SQL parameters.
 */
export type DbErrorInfo = { code?: string; message: string; table?: string; column?: string; constraint?: string; kind: string }

export function describeDbError(err: unknown): DbErrorInfo {
  const e = err as { code?: string; message?: string; cause?: Record<string, any>; name?: string } | null
  const c = (e?.cause ?? e) as Record<string, any> | undefined
  const code = c?.code ?? e?.code
  const message = String(c?.message ?? e?.message ?? err ?? 'unknown error').split('\n')[0].slice(0, 300)
  // SQLSTATE classes worth naming in a log line
  const kind =
    code === '42P01' ? 'missing table — migrations not applied?' :
    code === '42703' ? 'missing column — database schema older/newer than the code' :
    code === '28P01' || code === '28000' ? 'database authentication failed (wrong credentials)' :
    code === '53300' || /too many connections|MaxClients/i.test(message) ? 'database connection limit reached' :
    code === '57P01' || code === '57P03' ? 'database is shutting down / starting up' :
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|CONNECT_TIMEOUT/i.test(`${code} ${message}`) ? 'database unreachable' :
    /SSL/i.test(message) ? 'SSL/TLS mismatch between app and database (check ?sslmode=)' :
    'database error'
  return { code, message, table: c?.table_name, column: c?.column_name, constraint: c?.constraint_name, kind }
}
