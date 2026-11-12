/** Prints fresh secrets for .env / your secret manager. Never commit the output. */
import { randomBytes } from 'node:crypto';

const b64 = (n: number) => randomBytes(n).toString('base64');
const token = (n: number) => randomBytes(n).toString('base64url');
const keyId = `k${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;

console.log(`ENCRYPTION_KEYS=${keyId}:${b64(32)}`);
console.log(`ENCRYPTION_ACTIVE_KEY_ID=${keyId}`);
console.log(`PASSWORD_PEPPER=${b64(32)}`);
console.log(`METRICS_TOKEN=${token(32)}`);
console.log(`CRON_SECRET=${token(32)}`);
console.log('BACKUP_ENCRYPTION_PASSPHRASE=' + token(48));
