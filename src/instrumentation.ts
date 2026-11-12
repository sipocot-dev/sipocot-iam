import type { Instrumentation } from 'next';

/**
 * OpenTelemetry traces (exported via OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is set,
 * or to Vercel's collector on Vercel). Works identically in containers.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    const { registerOTel } = await import('@vercel/otel');
    registerOTel({ serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'sipocot-iam' });
  }
}

/** Server-side error boundary hook: every uncaught render / handler error is logged once. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { reportRequestError } = await import('./instrumentation-node');
  reportRequestError(...args);
};
