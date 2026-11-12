import type { DomainEvent } from './domain-event';

export abstract class AggregateRoot<TId extends string> {
  #events: DomainEvent[] = [];

  protected constructor(readonly id: TId) {}

  protected raise(event: DomainEvent): void {
    this.#events.push(event);
  }

  /** Returns and clears pending events; called by the application layer after persistence. */
  pullEvents(): readonly DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }
}
