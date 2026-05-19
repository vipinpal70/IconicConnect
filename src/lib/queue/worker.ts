import { Worker, Job } from 'bullmq';
import { connection } from './client';
import { resend } from '../resend';
import { runCleanup } from './cleanup-task';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  type: 'welcome' | 'credentials' | 'approval' | 'reset-password';
}

let worker: Worker | null = null;

if (process.env.NODE_ENV === 'production') {
  worker = createWorker();
} else {
  // In development, prevent multiple instances from starting due to HMR
  if (!(global as any).emailWorker) {
    (global as any).emailWorker = createWorker();
  }
  worker = (global as any).emailWorker;

  if (!(global as any).cleanupInterval) {
    // Run cleanup once in development on server startup
    setTimeout(() => {
      runCleanup().catch(console.error);
    }, 5000);

    // Schedule cleanup to run every 1 hour in development
    (global as any).cleanupInterval = setInterval(() => {
      runCleanup().catch(console.error);
    }, 60 * 60 * 1000);
  }
}

function createWorker() {
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
      connection,
      removeOnComplete: {
        age: 24 * 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 24 * 3600,
        count: 5000,
      },
    }
  );

  newWorker.on('completed', (job) => console.log(`[Worker] Job ${job.id} done`));
  newWorker.on('failed', (job, err) => console.error(`[Worker] Job ${job?.id} failed: ${err.message}`));
  
  console.log('[Worker] Email worker initialized');
  return newWorker;
}

export default worker;
