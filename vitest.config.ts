import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Real 3Shape packages can be 100 MB+; a range-read pass is still quick,
    // but give integration cases headroom.
    testTimeout: 30_000,
    // Database tests share one Postgres and Redis: one file at a time, or they see each other's users and events
    fileParallelism: process.env.SUPPORT_DB_TEST !== '1',
  },
  resolve: {
    // Mirror tsconfig `paths`: "@/*" -> "./*"
    alias: { '@': path.resolve(__dirname) },
  },
})
