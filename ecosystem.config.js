module.exports = {
  apps: [
    {
      name: 'iconic-connect-web',
      script: 'npm',
      args: 'run start',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        DISABLE_WORKER: 'true', // Next.js won't start the worker in this process
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
      },
    },
    {
      name: 'iconic-connect-cleanup',
      script: 'npx',
      args: 'tsx src/lib/queue/cleanup-task.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      watch: false,
      cron_restart: '0 * * * *',
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

