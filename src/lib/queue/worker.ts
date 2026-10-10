import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { createWorkerConnection } from './client';
import { processCaseCleanup, type CaseCleanupJob } from './case-cleanup';
import { processMaintenance, scheduleMaintenance } from './maintenance';
import { resend } from '../resend';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  type: 'welcome' | 'credentials' | 'approval' | 'reset-password' | 'notification';
}

let worker: Worker | null = null;

// Each BullMQ Worker needs its OWN Redis connection (blocking commands). Concurrency is per queue.
function startBackgroundWorkers() {
  const cleanup = new Worker<CaseCleanupJob>(
    'case-cleanup',
    async (job) => {
      const r = await processCaseCleanup(job.data);
      console.log(`[CaseCleanup] ${job.data.caseNumber ?? job.data.caseId}: ${r.objectsRequested} object(s) deleted, ${r.objectsKept} kept (still referenced), ${r.notificationsRemoved} notification(s) removed`);
      return r;
    },
    { connection: createWorkerConnection() as any, concurrency: 3 },
  );
  cleanup.on('failed', (job, err) => console.error(`[CaseCleanup] job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`));
  cleanup.on('error', (err) => console.error('[CaseCleanup] worker error:', err.message));

  const maintenance = new Worker(
    'maintenance',
    async (job) => processMaintenance(job.name),
    { connection: createWorkerConnection() as any, concurrency: 1 },
  );
  maintenance.on('failed', (job, err) => console.error(`[Maintenance] ${job?.name} failed: ${err.message}`));
  maintenance.on('error', (err) => console.error('[Maintenance] worker error:', err.message));
  scheduleMaintenance().catch((err) => console.error('[Maintenance] scheduling failed:', err.message));
  console.log('[Worker] case-cleanup + maintenance workers initialized');
}

if (process.env.NODE_ENV === 'production') {
  worker = createWorker();
  startBackgroundWorkers();
} else {
  // Prevent multiple worker instances across HMR reloads in development.
  // Store both the worker and its dedicated connection in global so they survive reloads.
  if (!(global as any).emailWorker) {
    (global as any).emailWorkerConnection = createWorkerConnection();
    (global as any).emailWorker = createWorker((global as any).emailWorkerConnection);
    startBackgroundWorkers();
  }
  worker = (global as any).emailWorker;
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
      connection: conn as any,
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
