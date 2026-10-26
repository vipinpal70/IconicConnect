import 'dotenv/config'
import postgres from 'postgres'

type SourceCredential = {
  user_id: string
  email: string | null
  phone: string | null
  password_hash: string | null
  email_verified_at: Date | null
  phone_verified_at: Date | null
  banned_until: Date | null
  deleted_at: Date | null
  user_metadata: Record<string, unknown> | null
  app_metadata: Record<string, unknown> | null
  password_changed_at: Date
  created_at: Date
  updated_at: Date
  last_login_at: Date | null
}
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type ExistingCredential = Pick<
  SourceCredential,
  | 'user_id'
  | 'email'
  | 'phone'
  | 'password_hash'
  | 'email_verified_at'
  | 'phone_verified_at'
  | 'banned_until'
  | 'deleted_at'
  | 'user_metadata'
  | 'app_metadata'
  | 'password_changed_at'
  | 'last_login_at'
  | 'created_at'
  | 'updated_at'
>

const APPLY = process.argv.includes('--apply')
const OLD_URL = process.env.OLD_DATABASE_URL ?? process.env.SUPABASE_DB_URL
const NEW_URL = process.env.NEW_DATABASE_URL ?? process.env.DATABASE_URL

class DryRunRollback extends Error {}

function databaseIdentity(raw: string): string {
  const url = new URL(raw)
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`
}

if (!OLD_URL) {
  throw new Error('Set OLD_DATABASE_URL or SUPABASE_DB_URL to the source database.')
}
if (!NEW_URL) {
  throw new Error('Set NEW_DATABASE_URL or DATABASE_URL to the destination database.')
}
if (databaseIdentity(OLD_URL) === databaseIdentity(NEW_URL)) {
  throw new Error('Source and destination identify the same database; refusing to continue.')
}

const source = postgres(OLD_URL, {
  max: 1,
  prepare: false,
  connect_timeout: 30,
})
const destination = postgres(NEW_URL, {
  max: 1,
  prepare: false,
})

const columns = [
  'user_id',
  'email',
  'phone',
  'password_hash',
  'email_verified_at',
  'phone_verified_at',
  'banned_until',
  'deleted_at',
  'user_metadata',
  'app_metadata',
  'password_changed_at',
  'last_login_at',
  'created_at',
  'updated_at',
] as const

function matchesExisting(a: SourceCredential, b: ExistingCredential): boolean {
  return a.user_id === b.user_id &&
    a.email === b.email &&
    a.phone === b.phone &&
    a.password_hash === b.password_hash &&
    a.email_verified_at?.getTime() === b.email_verified_at?.getTime() &&
    a.phone_verified_at?.getTime() === b.phone_verified_at?.getTime() &&
    a.banned_until?.getTime() === b.banned_until?.getTime() &&
    a.deleted_at?.getTime() === b.deleted_at?.getTime() &&
    JSON.stringify(a.user_metadata ?? {}) === JSON.stringify(b.user_metadata ?? {}) &&
    JSON.stringify(a.app_metadata ?? {}) === JSON.stringify(b.app_metadata ?? {}) &&
    a.password_changed_at?.getTime() === b.password_changed_at?.getTime() &&
    a.last_login_at?.getTime() === b.last_login_at?.getTime() &&
    a.created_at?.getTime() === b.created_at?.getTime() &&
    a.updated_at?.getTime() === b.updated_at?.getTime()
}

function asDate(value: unknown, nullable = false): Date | null {
  if (value == null && nullable) return null
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) throw new Error('Source auth record contains an invalid timestamp.')
  return date
}

function asString(value: unknown): string | null {
  return value == null ? null : String(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value)
    return asJsonObject(parsed)
  }
  if (!isPlainObject(value)) throw new Error('Source auth metadata is not a JSON object.')
  return value
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]),
    )
  }
  throw new Error('Source auth metadata contains a value that cannot be represented as JSON.')
}

async function main() {
  const oldIdentityCount = await source.begin(
    'isolation level repeatable read read only',
    async (old) => {
      const [{ count: externalIdentities }] = await old`
        select count(*)::int as count
        from auth.identities
        where provider <> 'email'
      `
      const [{ count: mfaFactors }] = await old`
        select count(*)::int as count
        from auth.mfa_factors
      `
      if (externalIdentities || mfaFactors) {
        throw new Error(
          `Auth migration paused: ${externalIdentities} non-email identities and ${mfaFactors} MFA factors need a verified migration/re-enrollment plan.`,
        )
      }

      const rows: SourceCredential[] = []
      await old`
        select
          id as user_id,
          lower(email) as email,
          phone,
          encrypted_password as password_hash,
          email_confirmed_at as email_verified_at,
          phone_confirmed_at as phone_verified_at,
          banned_until,
          deleted_at,
          raw_user_meta_data as user_metadata,
          raw_app_meta_data as app_metadata,
          created_at,
          updated_at,
          last_sign_in_at as last_login_at
        from auth.users
        order by id
      `.cursor(500, (batch) => {
        rows.push(...batch.map((row) => ({
          user_id: String(row.user_id),
          email: asString(row.email),
          phone: asString(row.phone),
          password_hash: asString(row.password_hash),
          email_verified_at: asDate(row.email_verified_at, true),
          phone_verified_at: asDate(row.phone_verified_at, true),
          banned_until: asDate(row.banned_until, true),
          deleted_at: asDate(row.deleted_at, true),
          user_metadata: asJsonObject(row.user_metadata),
          app_metadata: asJsonObject(row.app_metadata),
          password_changed_at: asDate(row.updated_at)!,
          created_at: asDate(row.created_at)!,
          updated_at: asDate(row.updated_at)!,
          last_login_at: asDate(row.last_login_at, true),
        })))
      })

      const collisions = new Set<string>()
      const emails = new Set<string>()
      for (const row of rows) {
        if (!row.email) continue
        const email = row.email.toLowerCase()
        if (emails.has(email)) collisions.add(email)
        emails.add(email)
      }
      if (collisions.size) {
        throw new Error(
          `Auth migration paused: ${collisions.size} case-insensitive email collisions exist. Resolve them before copying credentials.`,
        )
      }

      const [{ count }] = await old`select count(*)::int as count from auth.users`
      if (Number(count) !== rows.length) {
        throw new Error(`Source cursor returned ${rows.length} rows but count(*) returned ${count}.`)
      }
      return rows
    },
  )

  try {
    await destination.begin(async (tx) => {
      const [{ count: currentCount }] = await tx`
        select count(*)::int as count from public.auth_credentials
      `
      const existing = currentCount
        ? await tx<ExistingCredential[]>`
            select
              user_id,
              email,
              phone,
              password_hash,
              email_verified_at,
              phone_verified_at,
              banned_until,
              deleted_at,
              user_metadata,
              app_metadata,
              password_changed_at,
              last_login_at,
              created_at,
              updated_at
            from public.auth_credentials
            order by user_id
          `
        : []

      if (existing.length) {
        const sourceById = new Map(oldIdentityCount.map((row) => [row.user_id, row]))
        if (
          existing.length !== oldIdentityCount.length ||
          existing.some((row) => {
            const sourceRow = sourceById.get(row.user_id)
            return !sourceRow || !matchesExisting(sourceRow, row)
          })
        ) {
          throw new Error(
            'Destination already contains a different or partial credential copy. No rows were changed.',
          )
        }
        console.log(`Credentials already match: ${existing.length} auth users; no changes needed.`)
        return
      }

      for (let offset = 0; offset < oldIdentityCount.length; offset += 500) {
        const sourceRows = oldIdentityCount.slice(offset, offset + 500)
        const rows = sourceRows.map((row) => ({
          user_id: row.user_id,
          email: row.email,
          phone: row.phone,
          password_hash: row.password_hash,
          email_verified_at: row.email_verified_at,
          phone_verified_at: row.phone_verified_at,
          banned_until: row.banned_until,
          deleted_at: row.deleted_at,
          user_metadata: tx.json(toJsonValue(row.user_metadata ?? {})),
          app_metadata: tx.json(toJsonValue(row.app_metadata ?? {})),
          password_changed_at: row.updated_at,
          last_login_at: row.last_login_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }))
        await tx`
          insert into public.auth_credentials ${tx(rows, ...columns)}
        `
      }

      console.log(`Prepared ${oldIdentityCount.length} auth credential rows.`)
      console.log(`Rows with no password hash: ${oldIdentityCount.filter((row) => !row.password_hash).length}`)
      if (!APPLY) {
        console.log('Dry run: destination transaction rolled back. Use --apply to commit.')
        throw new DryRunRollback()
      }
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
}

main()
  .catch((error) => {
    console.error('[migrate-auth-credentials]', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await Promise.all([source.end({ timeout: 5 }), destination.end({ timeout: 5 })])
  })
