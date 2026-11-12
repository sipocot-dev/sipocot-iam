export interface IdGenerator {
  /** Time-ordered UUID (v7) — index friendly. */
  next(): string;
}
