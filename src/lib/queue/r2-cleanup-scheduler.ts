import { runR2Cleanup } from './r2-cleanup-task';

// Every 1.5 hours.
const INTERVAL_MS = 90 * 60 * 1000;

async function tick() {
  try {
    await runR2Cleanup();
  } catch (err) {
    console.error('[R2 Cleanup Scheduler] Error during cleanup run:', err);
  }
}

// Run once on startup, then every 1.5 hours. Process stays alive.
tick();
setInterval(tick, INTERVAL_MS);

console.log(
  `[R2 Cleanup Scheduler] Running every ${INTERVAL_MS / 60000} minutes. Process will stay alive.`
);
