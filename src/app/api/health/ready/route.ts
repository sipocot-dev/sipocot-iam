import { getContainer } from '@/composition/container';
import { runHealthChecks } from '@/shared/infrastructure/observability/health-checks';
import { fallbackLog } from '@/shared/interface/http/fallback-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'cache-control': 'no-store' };

/** Readiness: dependencies reachable. Kubernetes removes the pod from rotation on 503. */
export async function GET(): Promise<Response> {
  try {
    const c = getContainer();
    const report = await runHealthChecks(c.healthChecks);
    // Dependency error strings may contain hostnames: keep them in logs, not in the public response.
    if (report.status !== 'ok') c.logger.warn('readiness degraded', { checks: report.checks });
    const checks = Object.fromEntries(
      Object.entries(report.checks).map(([k, v]) => [k, { status: v.status, latencyMs: v.latencyMs }]),
    );
    return Response.json(
      { status: report.status, checks, version: c.version },
      { status: report.status === 'ok' ? 200 : 503, headers },
    );
  } catch (e) {
    // Invalid configuration: variable names + reasons go to logs; the public response stays generic.
    fallbackLog('error', 'readiness failed: container could not be built', e);
    return Response.json({ status: 'degraded', error: 'configuration' }, { status: 503, headers });
  }
}
