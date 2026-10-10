import { connection } from './queue/client';

const DEFAULT_TTL = 3600; // 1 hour default cache time

/**
 * Epoch-versioned cache.
 *
 * Keys that depend on mutable data live in an "epoch domain" (e.g. every case list/dashboard of one lab). The
 * stored key is `<key>@<epoch>`; invalidating the whole domain is ONE `INCR ver:<domain>` — O(1) — instead of
 * SCAN + DEL over the keyspace (O(total keys), slow on managed Redis, and racy). Old-epoch entries are never
 * read again and simply expire by TTL. Reads/writes are a single Lua round trip (epoch lookup + GET/SET).
 */
const GET_LUA = `
local v = redis.call('GET', KEYS[1]) or '0'
return redis.call('GET', ARGV[1] .. '@' .. v)
`;
const SET_LUA = `
local v = redis.call('GET', KEYS[1]) or '0'
return redis.call('SET', ARGV[1] .. '@' .. v, ARGV[2], 'EX', ARGV[3])
`;

/** key -> epoch-domain counter key (null = plain, TTL/explicit-DEL key). */
export function epochDomain(key: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = key.match(/^(?:cases:list:client|dashboard:client|cases:base:client):([^:]+)/))) return `ver:cases:${m[1]}`;
  if ((m = key.match(/^analytics:client:([^:]+):/))) return `ver:analytics:${m[1]}`;
  if ((m = key.match(/^billing:client:([^:]+):/))) return `ver:billing:${m[1]}`;
  if (/^(?:cases:list:admin|dashboard:admin|cases:base:admin|dashboard:ops:)/.test(key)) return 'ver:cases:staff';
  if (key === 'analytics:admin') return 'ver:analytics:staff';
  return null;
}

export async function getCachedData<T>(key: string): Promise<T | null> {
  if (connection.status !== 'ready') {
    return null;
  }
  try {
    const domain = epochDomain(key);
    const cached = domain
      ? ((await connection.eval(GET_LUA, 1, domain, key)) as string | null)
      : await connection.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch (error) {
    console.error(`[Redis Cache GET Error] Key: ${key}`, error);
  }
  return null;
}

export async function setCachedData<T>(
  key: string,
  data: T,
  ttlSeconds: number = DEFAULT_TTL
): Promise<void> {
  if (connection.status !== 'ready') {
    return;
  }
  try {
    const domain = epochDomain(key);
    if (domain) await connection.eval(SET_LUA, 1, domain, key, JSON.stringify(data), String(ttlSeconds));
    else await connection.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch (error) {
    console.error(`[Redis Cache SET Error] Key: ${key}`, error);
  }
}

export async function deleteCachedData(key: string): Promise<void> {
  if (connection.status !== 'ready') {
    return;
  }
  try {
    // Epoch-domain keys are invalidated by bumping the epoch (stale entries just expire).
    const domain = epochDomain(key);
    if (domain) await connection.incr(domain);
    else await connection.del(key);
  } catch (error) {
    console.error(`[Redis Cache DEL Error] Key: ${key}`, error);
  }
}

/** Kept for ad-hoc maintenance only — nothing on the request path scans the keyspace any more. */
export async function deleteKeysByPattern(pattern: string): Promise<void> {
  if (connection.status !== 'ready') {
    return;
  }
  try {
    let cursor = '0';
    do {
      const [newCursor, keys] = await connection.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;
      if (keys.length > 0) {
        await connection.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    console.error(`[Redis Cache Pattern DEL Error] Pattern: ${pattern}`, error);
  }
}

/**
 * Invalidates invoice and billing caches for a given client.
 * Pass invoiceId to also clear the single-invoice entry.
 */
export async function invalidateInvoiceCache(clientId: string, invoiceId?: string): Promise<void> {
  if (connection.status !== 'ready') return
  try {
    const keys: string[] = [
      'invoices:admin:all',
      'invoices:payments:admin',
      'billing:all',
      `invoices:client:${clientId}`,
    ]
    if (invoiceId) keys.push(`invoice:${invoiceId}`)
    await connection.multi()
      .del(...keys)
      .incr(`ver:billing:${clientId}`)    // billing:client:<id>:* pages
      .incr(`ver:analytics:${clientId}`)  // monthly-billing / recent-invoices analytics
      .incr('ver:analytics:staff')
      .exec()
  } catch (error) {
    console.error('[invalidateInvoiceCache]', error)
  }
}

/**
 * Invalidates notification caches for a user (list + unread count).
 */
export async function invalidateNotificationCache(userId: string): Promise<void> {
  if (connection.status !== 'ready') return
  try {
    // Direct DEL of the keys the UI actually uses — no keyspace SCAN (slow on managed Redis). Any other
    // list page/limit (API clients only) ages out via its 60s TTL.
    await connection.del(
      `notifications:${userId}:unread`,
      `notifications:${userId}:list:20:0`,
      `notifications:${userId}:list:5:0`,
      `sidebar-badges:${userId}`,
    )
  } catch (error) {
    console.error('[invalidateNotificationCache]', error)
  }
}

/**
 * Invalidates cases, dashboards and analytics after a case write: 3-4 INCRs in one MULTI, no keyspace scan.
 * Staff views refresh on any lab's change; a lab's views refresh only on its own.
 */
export async function invalidateCasesCache(clientId?: string | null): Promise<void> {
  if (connection.status !== 'ready') {
    console.warn(`[Redis Cache Invalidation] Redis is not ready. Skipping cache invalidation for Client: ${clientId || 'ALL'}`);
    return;
  }
  try {
    const m = connection.multi().incr('ver:cases:staff').incr('ver:analytics:staff');
    if (clientId) m.incr(`ver:cases:${clientId}`).incr(`ver:analytics:${clientId}`);
    await m.exec();
  } catch (error) {
    console.error('[Redis Cache Invalidation Error]', error);
  }
}
