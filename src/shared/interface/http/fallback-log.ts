/**
 * Last-resort structured logging for when the container (and therefore the real
 * logger) could not be built — typically invalid configuration. Never silent.
 */
export function fallbackLog(level: 'error' | 'warn', msg: string, error?: unknown): void {
  const err = error instanceof Error ? { type: error.name, message: error.message, stack: error.stack } : error;
  process.stderr.write(
    `${JSON.stringify({ level, msg, time: new Date().toISOString(), ...(err !== undefined && { err }) })}\n`,
  );
}

/** Wrap an operational endpoint so a broken container yields 503, not an opaque 500. */
export async function withContainer(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    fallbackLog('error', 'service unavailable', e);
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
