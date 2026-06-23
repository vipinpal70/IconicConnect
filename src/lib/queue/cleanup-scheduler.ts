import { runCleanup } from './cleanup-task';

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function tick() {
  try {
    await runCleanup();
  } catch (err) {
    console.error('[Cleanup Scheduler] Error during cleanup run:', err);
  }
}

// Run immediately on startup, then every hour
tick();
setInterval(tick, INTERVAL_MS);

console.log(`[Cleanup Scheduler] Running every ${INTERVAL_MS / 60000} minutes. Process will stay alive.`);
