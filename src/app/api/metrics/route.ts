import { getContainer } from '@/composition/container';
import { safeEqual } from '@/shared/infrastructure/crypto/hash';
import { withContainer } from '@/shared/interface/http/fallback-log';
import { readBearer } from '@/shared/interface/http/session-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Prometheus scrape endpoint, protected by a static bearer token. */
export function GET(req: Request): Promise<Response> {
  return withContainer(async () => {
    const c = getContainer();
    const expected = c.env.METRICS_TOKEN;
    const given = readBearer(req.headers.get('authorization'));
    if (!expected || !given || !safeEqual(given, expected)) {
      return new Response('unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } });
    }
    return new Response(await c.metrics.registry.metrics(), {
      headers: { 'content-type': c.metrics.registry.contentType, 'cache-control': 'no-store' },
    });
  });
}
