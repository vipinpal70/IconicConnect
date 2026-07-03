import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { runR2Retention } from './r2-retention-task';

/**
 * Quarterly scheduler for the R2 retention sweep.
 *
 * A plain setInterval(3 months) is unreliable for such a long cadence: any PM2
 * restart (deploy, crash, max_memory_restart) resets the timer, so over three
 * months it could easily never fire. Instead we persist the last successful run
 * to disk, tick once a day, and run only when a full RETENTION_MONTHS interval
 * has elapsed. The clock therefore survives restarts.
 */

const RETENTION_MONTHS = Number(process.env.R2_RETENTION_MONTHS) || 3;
const TICK_MS = 24 * 60 * 60 * 1000; // check once a day
const STATE_FILE =
  process.env.R2_RETENTION_STATE_FILE ||
  path.join(process.cwd(), '.r2-retention-state.json');

function readLastRun(): Date | null {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.lastRunAt ? new Date(parsed.lastRunAt) : null;
  } catch {
    return null;
  }
}

function writeLastRun(when: Date) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastRunAt: when.toISOString() }, null, 2));
  } catch (err) {
    console.error('[R2 Retention Scheduler] Failed to persist last-run state:', err);
  }
}

/** Next due time = lastRun + RETENTION_MONTHS (calendar months). */
function nextDue(lastRun: Date): Date {
  const due = new Date(lastRun);
  due.setMonth(due.getMonth() + RETENTION_MONTHS);
  return due;
}

async function tick() {
  const lastRun = readLastRun();
  const now = new Date();

  if (lastRun && now < nextDue(lastRun)) {
    // Not due yet — quietly wait for the next daily tick.
    return;
  }

  console.log(
    `[R2 Retention Scheduler] Running quarterly sweep ` +
      `(last run: ${lastRun ? lastRun.toISOString() : 'never'}).`
  );
  try {
    await runR2Retention();
    writeLastRun(now);
  } catch (err) {
    // Leave lastRun untouched so the sweep retries on the next tick.
    console.error('[R2 Retention Scheduler] Error during retention run:', err);
  }
}

// First run is deferred until RETENTION_MONTHS after the recorded last run.
// On a fresh install (no state file) the first tick runs immediately, then the
// timestamp gates every subsequent run to the quarterly cadence.
tick();
setInterval(tick, TICK_MS);

console.log(
  `[R2 Retention Scheduler] Active. Checking daily; deletes objects >= ${RETENTION_MONTHS} months old each quarter.`
);
