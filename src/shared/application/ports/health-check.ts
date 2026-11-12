export interface HealthCheck {
  readonly name: string;
  check(): Promise<void>;
}
