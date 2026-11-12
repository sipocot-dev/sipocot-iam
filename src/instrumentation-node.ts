import type { Instrumentation } from 'next';
import { getContainer } from './composition/container';

export const reportRequestError = (...[error, request, context]: Parameters<Instrumentation.onRequestError>): void => {
  const e = error as Error & { digest?: string };
  const fields = {
    digest: e.digest,
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    err: { type: e.name, message: e.message, stack: e.stack },
  };
  try {
    getContainer().logger.error('next request error', fields);
  } catch {
    // Container could not be built (bad config) — fall back to raw stderr JSON.
    process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'next request error', ...fields })}\n`);
  }
};
