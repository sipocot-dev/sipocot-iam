import pino, { type Logger as Pino } from 'pino';
import type { LogFields, Logger } from '@/shared/application/ports';

/** Never log these, at any depth we know about. */
export const REDACT_PATHS = [
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'phone',
  'authorization',
  'cookie',
  'set-cookie',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.phone',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

class PinoLogger implements Logger {
  constructor(private readonly p: Pino) {}
  debug(msg: string, fields?: LogFields): void {
    this.p.debug(fields ?? {}, msg);
  }
  info(msg: string, fields?: LogFields): void {
    this.p.info(fields ?? {}, msg);
  }
  warn(msg: string, fields?: LogFields): void {
    this.p.warn(fields ?? {}, msg);
  }
  error(msg: string, fields?: LogFields): void {
    this.p.error(fields ?? {}, msg);
  }
  child(bindings: LogFields): Logger {
    return new PinoLogger(this.p.child(bindings));
  }
}

export function createLogger(opts: {
  level: string;
  service: string;
  env: string;
  version: string;
  pretty?: boolean;
}): Logger {
  const p = pino({
    level: opts.level,
    base: { service: opts.service, env: opts.env, version: opts.version },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: { level: (label) => ({ level: label }) },
    serializers: { err: pino.stdSerializers.err },
    ...(opts.pretty && {
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } },
    }),
  });
  return new PinoLogger(p);
}

/** Serialise unknown errors safely for structured logs. */
export const errorFields = (e: unknown): LogFields =>
  e instanceof Error
    ? { err: { type: e.name, message: e.message, stack: e.stack, cause: e.cause } }
    : { err: { message: String(e) } };
