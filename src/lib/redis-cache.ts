import { connection } from './queue/client';

const DEFAULT_TTL = 3600; // 1 hour default cache time

export async function getCachedData<T>(key: string): Promise<T | null> {
  if (connection.status !== 'ready') {
    return null;
  }
  try {
    const cached = await connection.get(key);
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
    await connection.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch (error) {
    console.error(`[Redis Cache SET Error] Key: ${key}`, error);
  }
}

export async function deleteCachedData(key: string): Promise<void> {
  if (connection.status !== 'ready') {
    return;
  }
  try {
    await connection.del(key);
  } catch (error) {
    console.error(`[Redis Cache DEL Error] Key: ${key}`, error);
  }
}

/**
 * Scan and delete all keys matching a specific pattern.
 * Note: Uses SCAN rather than KEYS to avoid blocking the Redis server thread.
 */
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
    await connection.del(...keys)
    await deleteKeysByPattern(`billing:client:${clientId}:*`)
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
    await deleteKeysByPattern(`notifications:${userId}:*`)
  } catch (error) {
    console.error('[invalidateNotificationCache]', error)
  }
}

/**
 * Invalidates cases and dashboard caches for clients and admins
 */
export async function invalidateCasesCache(clientId?: string | null): Promise<void> {
  if (connection.status !== 'ready') {
    console.warn(`[Redis Cache Invalidation] Redis is not ready. Skipping cache invalidation for Client: ${clientId || 'ALL'}`);
    return;
  }
  try {
    const keysToDelete: string[] = ['cases:base:admin', 'dashboard:admin', 'analytics:admin'];

    if (clientId) {
      keysToDelete.push(`cases:base:client:${clientId}`);
      keysToDelete.push(`dashboard:client:${clientId}`);
      await Promise.all([
        connection.del(...keysToDelete),
        deleteKeysByPattern(`cases:list:client:${clientId}:*`),
        deleteKeysByPattern(`analytics:client:${clientId}:*`),
      ]);
    } else {
      await connection.del(...keysToDelete);
      await Promise.all([
        deleteKeysByPattern('cases:list:client:*'),
        deleteKeysByPattern('cases:list:admin:*'),
        deleteKeysByPattern('dashboard:client:*'),
        deleteKeysByPattern('analytics:client:*'),
      ]);
    }

    console.log(`[Redis Cache Invalidation] Invalidated cache for Client: ${clientId || 'ALL'}`);
  } catch (error) {
    console.error('[Redis Cache Invalidation Error]', error);
  }
}
