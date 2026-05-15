import { Queue, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  // Upstash compatibility settings
  tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
  enableReadyCheck: false,
});

export const emailQueue = new Queue('email-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    // Automatically cleanup jobs from Redis after 24 hours (24 * 3600 seconds)
    removeOnComplete: {
      age: 24 * 3600, // keep up to 24 hours
      count: 1000,    // or maximum 1000 completed jobs
    },
    removeOnFail: {
      age: 24 * 3600, // keep up to 24 hours
      count: 5000,    // or maximum 5000 failed jobs
    },
  },
});
