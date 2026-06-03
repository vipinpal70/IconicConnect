import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { createWorkerConnection } from './client';
import { resend } from '../resend';
import { runCleanup } from './cleanup-task';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  type: 'welcome' | 'credentials' | 'approval' | 'reset-password' | 'notification';
}

let worker: Worker | null = null;

if (process.env.NODE_ENV === 'production') {
  worker = createWorker();
} else {
  // Prevent multiple worker instances across HMR reloads in development.
  // Store both the worker and its dedicated connection in global so they survive reloads.
  if (!(global as any).emailWorker) {
    (global as any).emailWorkerConnection = createWorkerConnection();
    (global as any).emailWorker = createWorker((global as any).emailWorkerConnection);
  }
  worker = (global as any).emailWorker;

  if (!(global as any).cleanupInterval) {
    setTimeout(() => {
      runCleanup().catch(console.error);
    }, 5000);

    (global as any).cleanupInterval = setInterval(() => {
      runCleanup().catch(console.error);
    }, 60 * 60 * 1000);
  }
}

function createWorker(conn = createWorkerConnection()) {
  const newWorker = new Worker<EmailJobData>(
    'email-queue',
    async (job: Job<EmailJobData>) => {
      const { to, subject, html } = job.data;

      console.log(`[Worker] Processing job ${job.id} for ${to}`);

      try {
        const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';
        const { data, error } = await resend.emails.send({
          from: `IconicConnect <${fromEmail}>`,
          to: [to],
          subject,
          html,
        });

        if (error) {
          console.error(`[Worker] Resend Error details:`, JSON.stringify(error, null, 2));
          throw error;
        }
        console.log(`[Worker] Job ${job.id} completed:`, data?.id);
      } catch (err) {
        console.error(`[Worker] Failed job ${job.id}:`, err);
        throw err;
      }
    },
    {
      connection: conn,
      removeOnComplete: {
        age: 3600,   // 1 hour
        count: 1000,
      },
      removeOnFail: {
        age: 3600,   // 1 hour
        count: 5000,
      },
    }
  );

  newWorker.on('completed', (job) => console.log(`[Worker] Job ${job.id} done`));
  newWorker.on('failed', (job, err) => console.error(`[Worker] Job ${job?.id} failed: ${err.message}`));
  newWorker.on('error', (err) => console.error('[Worker] Worker error:', err.message));

  console.log('[Worker] Email worker initialized');
  return newWorker;
}

export default worker;
