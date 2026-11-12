import { problemResponse } from '@/shared/interface/http/problem';
import { resolveRequestId } from '@/shared/interface/http/request-meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** JSON 404 for unknown API paths instead of the HTML not-found page. */
function notFound(req: Request): Response {
  return problemResponse({
    status: 404,
    code: 'route_not_found',
    detail: 'No such endpoint',
    requestId: resolveRequestId(req.headers),
    instance: new URL(req.url).pathname,
  });
}

export { notFound as DELETE, notFound as GET, notFound as PATCH, notFound as POST, notFound as PUT };
