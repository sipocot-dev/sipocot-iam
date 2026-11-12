import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/infrastructure/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/sipocot_iam' },
  strict: true,
  verbose: true,
});
