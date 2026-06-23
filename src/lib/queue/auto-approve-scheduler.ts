import { runAutoApprove } from './auto-approve-task';

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function tick() {
  try {
    await runAutoApprove();
  } catch (err) {
    console.error('[AutoApprove Scheduler] Error during auto-approve run:', err);
  }
}

// Run immediately on startup, then every hour
tick();
setInterval(tick, INTERVAL_MS);

console.log(`[AutoApprove Scheduler] Running every ${INTERVAL_MS / 60000} minutes. Process will stay alive.`);
