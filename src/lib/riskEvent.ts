import type { RiskEvaluation, RiskReasonCode } from "./riskEngine";

export type RiskEventType =
  | "DAILY_LOSS_LIMIT_BREACH"
  | "MAX_DRAWDOWN_BREACH"
  | "PRE_TRADE_RISK_REJECTION"
  | "ACCOUNT_RISK_STATE_CHANGE"
  | "ACCOUNT_RISK_BLOCKED";

export type RiskEventSeverity = "critical" | "warning" | "info";
export type RiskEventStatus = "open" | "resolved";
export type RiskEventSource = "risk_engine" | "challenge_engine" | "account_lifecycle" | "execution_service";

export interface CanonicalRiskEvent {
  id: string;
  accountId: string;
  eventType: RiskEventType;
  severity: RiskEventSeverity;
  status: RiskEventStatus;
  metricName: string | null;
  metricValue: number | string | boolean | null;
  configuredLimit: number | string | boolean | null;
  reason: string;
  source: RiskEventSource;
  occurredAt: string;
  resolvedAt: string | null;
  reference: string;
  metadata: Record<string, unknown>;
}

interface RiskEventFactoryParams {
  accountId: string;
  eventType: RiskEventType;
  reason: string;
  metricName: string | null;
  metricValue: number | string | boolean | null;
  configuredLimit: number | string | boolean | null;
  source: RiskEventSource;
  status?: RiskEventStatus;
  severity?: RiskEventSeverity;
  occurredAt?: string;
  resolvedAt?: string | null;
  metadata?: Record<string, unknown>;
}

function normalizeString(value: unknown): string {
  return value == null ? "null" : String(value);
}

function hashStable(...parts: unknown[]): string {
  const source = parts.map((value) => normalizeString(value)).join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function toRiskEventType(reasonCode: RiskReasonCode | null): RiskEventType {
  switch (reasonCode) {
    case "DAILY_LOSS_EXCEEDED":
      return "DAILY_LOSS_LIMIT_BREACH";
    case "DRAWDOWN_EXCEEDED":
      return "MAX_DRAWDOWN_BREACH";
    case "ACCOUNT_LOCKED":
    case "ACCOUNT_BREACHED":
      return "ACCOUNT_RISK_STATE_CHANGE";
    case "ACCOUNT_NOT_ACTIVE":
      return "ACCOUNT_RISK_BLOCKED";
    default:
      return "PRE_TRADE_RISK_REJECTION";
  }
}

function deriveSeverity(eventType: RiskEventType, status: RiskEventStatus): RiskEventSeverity {
  if (eventType === "ACCOUNT_RISK_STATE_CHANGE" || eventType === "ACCOUNT_RISK_BLOCKED") return "critical";
  if (status === "open") return "warning";
  return "info";
}

function createCanonicalRiskEvent(params: RiskEventFactoryParams): CanonicalRiskEvent {
  const status = params.status ?? "open";
  const severity = params.severity ?? deriveSeverity(params.eventType, status);
  const occurredAt = params.occurredAt ?? new Date().toISOString();
  const metadata = { ...(params.metadata ?? {}) };
  const digest = hashStable(
    params.accountId,
    params.eventType,
    params.reason,
    params.metricName,
    params.metricValue,
    params.configuredLimit,
    params.source,
    status,
  );
  const reference = `${params.accountId}:${params.source}:${params.eventType}:${digest}`;

  return {
    id: reference,
    accountId: params.accountId,
    eventType: params.eventType,
    severity,
    status,
    metricName: params.metricName,
    metricValue: params.metricValue,
    configuredLimit: params.configuredLimit,
    reason: params.reason,
    source: params.source,
    occurredAt,
    resolvedAt: params.resolvedAt ?? (status === "resolved" ? occurredAt : null),
    reference,
    metadata,
  };
}

export function createRiskEventFromRiskEvaluation(
  evaluation: RiskEvaluation,
  options: { source?: RiskEventSource; metadata?: Record<string, unknown> } = {},
): CanonicalRiskEvent | null {
  if (evaluation.decision === "ALLOW") return null;

  const source = options.source ?? "risk_engine";
  const eventType = toRiskEventType(evaluation.reason_code);
  const status: RiskEventStatus = "open";

  return createCanonicalRiskEvent({
    accountId: evaluation.account_id,
    eventType,
    reason: evaluation.reason,
    metricName: evaluation.rule_evaluated,
    metricValue: evaluation.current_value,
    configuredLimit: evaluation.configured_limit,
    source,
    status,
    severity: deriveSeverity(eventType, status),
    occurredAt: evaluation.timestamp,
    metadata: {
      ...options.metadata,
      decision: evaluation.decision,
      reasonCode: evaluation.reason_code,
      riskState: evaluation.risk_state,
      timestamp: evaluation.timestamp,
    },
  });
}

export interface AccountRiskStateTransitionInput {
  accountId: string;
  previousState: string;
  nextState: string;
  reason: string;
  source?: RiskEventSource;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export function createAccountRiskStateTransitionEvent(
  input: AccountRiskStateTransitionInput,
): CanonicalRiskEvent {
  const source = input.source ?? "account_lifecycle";
  const status: RiskEventStatus = input.nextState === "ACTIVE" ? "resolved" : "open";
  const eventType: RiskEventType = "ACCOUNT_RISK_STATE_CHANGE";

  return createCanonicalRiskEvent({
    accountId: input.accountId,
    eventType,
    reason: input.reason,
    metricName: "risk_state",
    metricValue: input.nextState,
    configuredLimit: input.previousState,
    source,
    status,
    severity: status === "open" ? "critical" : "info",
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    metadata: {
      ...(input.metadata ?? {}),
      previousState: input.previousState,
      nextState: input.nextState,
      transitionedBy: source,
    },
  });
}

export class RiskEventLedger {
  private readonly events = new Map<string, CanonicalRiskEvent>();
  private readonly accountIndex = new Map<string, string[]>();

  recordRiskEvent(event: CanonicalRiskEvent | null): { event: CanonicalRiskEvent; replayed: boolean } | null {
    if (!event) return null;

    const existing = this.events.get(event.reference);
    if (existing) {
      return { event: existing, replayed: true };
    }

    this.events.set(event.reference, event);

    const accountEvents = this.accountIndex.get(event.accountId) ?? [];
    if (!accountEvents.includes(event.reference)) {
      accountEvents.push(event.reference);
      this.accountIndex.set(event.accountId, accountEvents);
    }

    return { event, replayed: false };
  }

  getEvents(accountId?: string): CanonicalRiskEvent[] {
    if (accountId) {
      const references = this.accountIndex.get(accountId) ?? [];
      return references
        .map((reference) => this.events.get(reference))
        .filter((event): event is CanonicalRiskEvent => Boolean(event));
    }
    return [...this.events.values()];
  }

  getOpenEvents(accountId?: string): CanonicalRiskEvent[] {
    return this.getEvents(accountId).filter((event) => event.status === "open");
  }

  clear(): void {
    this.events.clear();
    this.accountIndex.clear();
  }
}
