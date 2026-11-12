import type { DomainEvent } from '@/shared/domain';

export interface EventContext {
  readonly actorId?: string | undefined;
  readonly ip?: string | undefined;
  readonly requestId?: string | undefined;
}

/** Outbound port for domain events (audit log today; a message bus tomorrow). */
export interface EventPublisher {
  publish(events: readonly DomainEvent[], context: EventContext): Promise<void>;
}
