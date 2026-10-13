// Server: 4 vCPU / 16 GB RAM. Postgres + Redis run in Docker on the same box (docker-compose.dev.yml).
//
// ONE COMMAND for everything (Postgres + Redis containers -> migrations -> build -> PM2 web/worker/schedulers):
//     npm run server:up
// Stop the app processes:  npm run server:down      (the database containers keep running)
//
// CPU plan: 2 web processes in cluster mode (they share port 4000), leaving the other cores for the
// worker, the schedulers, Redis and Postgres.
//
// Database connections (local Postgres, default max_connections = 100): every process has its own pool,
// sized by DB_POOL_MAX.
//   web        2 processes x 6 = 12
//   worker     1 process   x 2 =  2
//   schedulers 3 x 1           =  3        -> 17 in total (leave headroom for dbmate, psql and backups)
const WEB_INSTANCES = 2
const DB_POOL_WEB = '6'
const DB_POOL_WORKER = '2'
const DB_POOL_SCHEDULER = '1'

module.exports = {
  apps: [
    {
      name: 'iconic-connect-web',
      cwd: __dirname, // run from the project folder no matter where `pm2 start` is typed
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
      cwd: __dirname, // run from the project folder no matter where `pm2 start` is typed
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
      name: 'iconic-connect-auto-approve',
      cwd: __dirname, // run from the project folder no matter where `pm2 start` is typed
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
      cwd: __dirname, // run from the project folder no matter where `pm2 start` is typed
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
      cwd: __dirname, // run from the project folder no matter where `pm2 start` is typed
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

