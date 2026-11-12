import { NextResponse, type NextRequest } from 'next/server';

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Runs before every matched request:
 *  - assigns / propagates a correlation id (x-request-id)
 *  - sets a nonce-based Content-Security-Policy for HTML pages
 * Keep it dependency-free: no DB / Redis here.
 */
export function proxy(request: NextRequest) {
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);

  const isApi = request.nextUrl.pathname.startsWith('/api/');
  let csp: string;
  if (isApi) {
    csp = "default-src 'none'; frame-ancestors 'none'";
  } else {
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const dev = process.env.NODE_ENV === 'development';
    csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
      `style-src 'self'${dev ? " 'unsafe-inline'" : ` 'nonce-${nonce}'`}`,
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ');
    headers.set('x-nonce', nonce);
  }
  headers.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)' }],
};
