import { emailQueue, connection } from './client';
import { EmailJobData as JobData } from './worker';

export async function queueEmail(data: JobData) {
  try {
    if (connection.status !== 'ready') {
      throw new Error(`Redis connection is not ready (status: ${connection.status})`);
    }
    const job = await emailQueue.add(data.type, data);
    console.log(`[Queue] Added job ${job.id} of type ${data.type} to ${data.to}`);
    return job;
  } catch (error) {
    console.error('[Queue] Failed to add job to queue:', error);
    throw error;
  }
}
