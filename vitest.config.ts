import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Real 3Shape packages can be 100 MB+; a range-read pass is still quick,
    // but give integration cases headroom.
    testTimeout: 30_000,
  },
  resolve: {
    // Mirror tsconfig `paths`: "@/*" -> "./*"
    alias: { '@': path.resolve(__dirname) },
  },
})
