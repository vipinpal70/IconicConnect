// Server: 4 vCPU / 16 GB RAM (Redis runs in Docker on the same box).
//
// CPU plan: 3 web processes in cluster mode (they share port 4000) + 1 core left for the worker,
// the schedulers, Redis and nginx.
//
// Database connections (Supabase pooler): every process has its own pool, sized by DB_POOL_MAX.
//   web      3 processes x 8  = 24
//   worker   1 process   x 3  =  3
//   schedulers 4 x 1          =  4        -> 31 in total
// Keep the total at or below Supabase "Pool size" (Dashboard -> Database -> Connection pooling) —
// set that to ~40 BEFORE deploying this file, otherwise requests just queue at the pooler.
const WEB_INSTANCES = 2
const DB_POOL_WEB = '6'
const DB_POOL_WORKER = '2'
const DB_POOL_SCHEDULER = '1'

module.exports = {
  apps: [
    {
      name: 'iconic-connect-web',
      // Cluster mode needs a node script (not `npm run start`); this is what `next start` runs.
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 4000',
      instances: WEB_INSTANCES,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      kill_timeout: 10000, // let in-flight requests (uploads, downloads) finish on reload/stop
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        DISABLE_WORKER: 'true', // Next.js won't start the worker in this process
        DB_POOL_MAX: DB_POOL_WEB,
      },
    },
    {
      name: 'iconic-connect-worker',
      script: 'npx',
      args: 'tsx src/lib/queue/worker.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        DB_POOL_MAX: DB_POOL_WORKER,
      },
    },
    {
      name: 'iconic-connect-cleanup',
      script: 'npx',
      args: 'tsx src/lib/queue/cleanup-scheduler.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        DB_POOL_MAX: DB_POOL_SCHEDULER,
      },
    },
    {
      name: 'iconic-connect-auto-approve',
      script: 'npx',
      args: 'tsx src/lib/queue/auto-approve-scheduler.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        DB_POOL_MAX: DB_POOL_SCHEDULER,
      },
    },
    {
      name: 'iconic-connect-r2-cleanup',
      script: 'npx',
      args: 'tsx src/lib/queue/r2-cleanup-scheduler.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        DB_POOL_MAX: DB_POOL_SCHEDULER,
      },
    },
    {
      name: 'iconic-connect-r2-retention',
      script: 'npx',
      args: 'tsx src/lib/queue/r2-retention-scheduler.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        DB_POOL_MAX: DB_POOL_SCHEDULER,
      },
    },
  ],
};

