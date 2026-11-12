import type { EventContext, EventPublisher, IdGenerator, Logger } from '@/shared/application/ports';
import { isUuid, type DomainEvent } from '@/shared/domain';
import type { Database } from '../db/client';
import { auditEvents } from '../db/schema';

/** Persists domain events into the append-only audit trail and mirrors them to logs. */
export class DrizzleAuditPublisher implements EventPublisher {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
    private readonly logger: Logger,
  ) {}

  async publish(events: readonly DomainEvent[], ctx: EventContext): Promise<void> {
    if (events.length === 0) return;
    await this.db.insert(auditEvents).values(
      events.map((e) => ({
        id: this.ids.next(),
        type: e.type,
        aggregateId: e.aggregateId,
        actorId: ctx.actorId && isUuid(ctx.actorId) ? ctx.actorId : null,
        ip: ctx.ip ?? null,
        requestId: ctx.requestId ?? null,
        payload: { ...e.payload },
        occurredAt: e.occurredAt,
      })),
    );
    for (const e of events)
      this.logger.info('audit', {
        event: e.type,
        aggregateId: e.aggregateId,
        actorId: ctx.actorId,
        requestId: ctx.requestId,
      });
  }
}
