import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export interface Metrics {
  readonly registry: Registry;
  readonly httpRequests: Counter<'method' | 'route' | 'status'>;
  readonly httpDuration: Histogram<'method' | 'route' | 'status'>;
  readonly authEvents: Counter<'event' | 'outcome'>;
  readonly rateLimited: Counter<'policy'>;
}

const g = globalThis as unknown as { __sipocotMetrics?: Metrics };

/** Process-wide singleton (survives Next.js dev HMR, avoids duplicate registration). */
export function getMetrics(): Metrics {
  if (g.__sipocotMetrics) return g.__sipocotMetrics;
  const registry = new Registry();
  registry.setDefaultLabels({ service: 'sipocot-iam' });
  collectDefaultMetrics({ register: registry });
  const metrics: Metrics = {
    registry,
    httpRequests: new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    authEvents: new Counter({
      name: 'auth_events_total',
      help: 'Authentication outcomes',
      labelNames: ['event', 'outcome'],
      registers: [registry],
    }),
    rateLimited: new Counter({
      name: 'rate_limited_total',
      help: 'Requests rejected by rate limiting',
      labelNames: ['policy'],
      registers: [registry],
    }),
  };
  g.__sipocotMetrics = metrics;
  return metrics;
}
