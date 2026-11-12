export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness: the process is up and the event loop responds. No dependency checks (avoid restart storms). */
export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
