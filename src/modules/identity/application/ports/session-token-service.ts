export interface IssuedToken {
  /** Returned to the client exactly once. */
  readonly token: string;
  /** Stored server-side. */
  readonly hash: string;
}

export interface SessionTokenService {
  issue(): IssuedToken;
  hash(token: string): string;
}
