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

/**
 * Queue an email without ever throwing, for callers whose primary action has
 * already succeeded by the time they send a notification about it (e.g. a
 * password was already changed — failing to email the new credentials isn't
 * a reason to report the whole request as failed). Returns whether the job
 * was actually queued so the caller can tell the truth to whoever's waiting
 * on the response, instead of the two anti-patterns this replaces:
 * `await queueEmail(...)` with no catch (a queue failure 500s the entire
 * request, even though the primary action already succeeded), or
 * `queueEmail(...).catch(console.error)` (the failure is swallowed
 * entirely — every caller reports success regardless of what happened).
 */
export async function queueEmailSafely(data: JobData): Promise<{ queued: boolean; error?: string }> {
  try {
    await queueEmail(data);
    return { queued: true };
  } catch (error) {
    return { queued: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
