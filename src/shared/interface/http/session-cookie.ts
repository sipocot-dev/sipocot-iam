export interface CookieConfig {
  readonly secure: boolean;
}

/** `__Host-` prefix: browser enforces Secure, Path=/ and no Domain → no subdomain injection. */
export const sessionCookieName = (c: CookieConfig): string => (c.secure ? '__Host-sipocot_sid' : 'sipocot_sid');

export function serializeSessionCookie(c: CookieConfig, token: string, expiresAt: Date, now: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return [
    `${sessionCookieName(c)}=${token}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(c.secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(c: CookieConfig): string {
  return [
    `${sessionCookieName(c)}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
    ...(c.secure ? ['Secure'] : []),
  ].join('; ');
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

export function readBearer(header: string | null): string | undefined {
  const m = header ? /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/i.exec(header) : null;
  return m?.[1];
}
