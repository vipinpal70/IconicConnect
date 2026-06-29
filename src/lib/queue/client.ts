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
