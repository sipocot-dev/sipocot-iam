import type { Clock } from '@/shared/application/ports';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
