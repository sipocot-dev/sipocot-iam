import { existsSync } from 'node:fs';

/** Load `.env` for local script runs; in CI / Kubernetes variables come from the environment. */
export function loadDotEnv(): void {
  for (const f of ['.env.local', '.env']) {
    if (existsSync(f)) {
      process.loadEnvFile(f);
      return;
    }
  }
}
