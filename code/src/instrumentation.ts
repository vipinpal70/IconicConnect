export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Initializing background workers...');
    await import('@/src/lib/queue/worker');
  }
}
