import 'dotenv/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redisOptions = {
  maxRetriesPerRequest: null,
  tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
  enableReadyCheck: false,
} as const;

// Queue connection — used only for adding jobs and reading state
export const connection = new IORedis(REDIS_URL, redisOptions);
connection.on('error', (err) => {
  console.error('[Redis Client Connection Error]', err.message || err);
});

// Separate connection for the worker — BullMQ workers use blocking Redis commands
// (BRPOPLPUSH) that must not share a connection with the queue
export function createWorkerConnection() {
  const conn = new IORedis(REDIS_URL, redisOptions);
  conn.on('error', (err) => {
    console.error('[Redis Worker Connection Error]', err.message || err);
  });
  return conn;
}

export const emailQueue = new Queue('email-queue', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: {
      age: 3600,   // 1 hour
      count: 1000,
    },
    removeOnFail: {
      age: 3600,   // 1 hour
      count: 5000,
    },
  },
});

/**
 * Post-delete cleanup (R2 objects, stale notifications). Its own queue so a burst of deletions can never starve
 * the email queue, and so its concurrency / retry policy is tuned independently — but consumed by the SAME
 * worker process (no extra PM2 process needed; add another worker instance only if volume ever demands it).
 */
export const caseCleanupQueue = new Queue('case-cleanup', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s, 40s, 80s — rides out R2/network blips
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 }, // keep failures a week for inspection; the orphan sweep is the safety net
  },
});

/** Scheduled housekeeping (audit-log retention, analytics rollup refresh). */
export const maintenanceQueue = new Queue('maintenance', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 24 * 3600, count: 200 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
