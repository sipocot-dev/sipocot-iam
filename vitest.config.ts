import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));
const serverOnlyStub = fileURLToPath(new URL('./tests/support/server-only-stub.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${src}/` },
      { find: 'server-only', replacement: serverOnlyStub },
    ],
  },
  test: {
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/modules/**/{domain,application}/**',
        'src/shared/{domain,application}/**',
        'src/shared/infrastructure/{crypto,rate-limit}/**',
        'src/shared/interface/**',
      ],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
