import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

export function resolveRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER);
  return incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
}

/**
 * Client IP. Only trust forwarding headers when behind a proxy we control
 * (Vercel edge, Kubernetes ingress); otherwise they are attacker-controlled.
 */
export function resolveClientIp(headers: Headers, trustProxy: boolean): string | undefined {
  if (!trustProxy) return undefined;
  const candidates = [headers.get('x-real-ip'), headers.get('x-forwarded-for')?.split(',')[0]];
  for (const c of candidates) {
    const ip = c?.trim();
    if (ip && isIP(ip)) return ip;
  }
  return undefined;
}
