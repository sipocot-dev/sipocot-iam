export interface PageRequest {
  readonly limit: number;
  /** Opaque cursor returned by the previous page. */
  readonly cursor?: string | undefined;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
