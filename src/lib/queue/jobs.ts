import { emailQueue } from './client';
import { EmailJobData as JobData } from './worker';

export async function queueEmail(data: JobData) {
  try {
    const job = await emailQueue.add(data.type, data);
    console.log(`[Queue] Added job ${job.id} of type ${data.type} to ${data.to}`);
    return job;
  } catch (error) {
    console.error('[Queue] Failed to add job to queue:', error);
    throw error;
  }
}
