export async function register() {
  // NEXT_RUNTIME is 'nodejs' for Node.js runtime, 'edge' for Edge runtime.
  // Treat undefined/empty as Node.js (never attempt to load bullmq in Edge).
  const runtime = process.env.NEXT_RUNTIME;
  const isNodeRuntime = !runtime || runtime === 'nodejs';

  if (isNodeRuntime && process.env.DISABLE_WORKER !== 'true') {
    console.log('[Instrumentation] Initializing background workers...');
    await import('@/src/lib/queue/worker');
  }
}
