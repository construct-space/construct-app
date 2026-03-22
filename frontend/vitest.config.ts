import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'frontend/**/*.test.ts',
      'frontend/**/*.spec.ts',
    ],
  },
  resolve: {
    alias: {
      '@construct/sdk': resolve(__dirname, 'lib/constructSdk.ts'),
      '@': resolve(__dirname, '.'),
      '~': resolve(__dirname, '.'),
    },
  },
})
