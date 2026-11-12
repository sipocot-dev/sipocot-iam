/** Authenticated symmetric encryption for data at rest (PII columns, secrets). */
export interface Encryptor {
  encrypt(plaintext: string, associatedData?: string): string;
  decrypt(ciphertext: string, associatedData?: string): string;
  /** True when the ciphertext was produced with a non-active key and should be re-encrypted. */
  needsReEncryption(ciphertext: string): boolean;
}
