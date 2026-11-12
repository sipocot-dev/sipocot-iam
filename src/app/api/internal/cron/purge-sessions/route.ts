import { getContainer } from '@/composition/container';
import { safeEqual } from '@/shared/infrastructure/crypto/hash';
import { withContainer } from '@/shared/interface/http/fallback-log';
import { readBearer } from '@/shared/interface/http/session-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Scheduled housekeeping. Vercel Cron: see vercel.json. Kubernetes: deploy/k8s/base/cronjobs.yaml. */
export function GET(req: Request): Promise<Response> {
  return withContainer(async () => {
    const c = getContainer();
    const secret = c.env.CRON_SECRET;
    const given = readBearer(req.headers.get('authorization'));
    if (!secret || !given || !safeEqual(given, secret)) return new Response('unauthorized', { status: 401 });

    const r = await c.identity.purgeSessions.execute({ retentionDays: c.env.SESSION_RETENTION_DAYS });
    if (!r.ok) return Response.json({ error: r.error.code }, { status: 500 });
    c.logger.info('purged ended sessions', { purged: r.value.purged });
    return Response.json(r.value, { headers: { 'cache-control': 'no-store' } });
  });
}
