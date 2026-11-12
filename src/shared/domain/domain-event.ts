export interface DomainEvent<TType extends string = string, TPayload = Readonly<Record<string, unknown>>> {
  readonly type: TType;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}
