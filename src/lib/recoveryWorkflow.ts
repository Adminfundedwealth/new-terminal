import type { BrokerRuntime, BrokerOrderStatus } from "./brokerRuntime";
import {
  normalizeBrokerState,
  reconcileBrokerCanonicalState,
  resolveBrokerCanonicalMismatch,
  type CanonicalStateLike,
  type BrokerNormalizedState,
  type CanonicalOrderLike,
  type CanonicalExecutionLike,
  type CanonicalPositionLike,
  type MismatchResolutionResult,
} from "./brokerReconciliation";

export type RecoveryStatus = "COMPLETED" | "UNRESOLVED";
export type RecoveryEvidence = "BROKER_CONFIRMED" | "BROKER_REJECTED" | "BROKER_UNAVAILABLE" | "INSUFFICIENT_EVIDENCE";

export interface RecoveryRequest {
  accountId: string;
  authUserId: string;
  brokerOrderId: string;
  clientOrderId?: string | null;
  canonicalState: CanonicalStateLike;
  riskAllowed?: boolean;
  recoveryReference?: string;
}

export interface RecoveryResult {
  recoveryReference: string;
  status: RecoveryStatus;
  evidence: RecoveryEvidence;
  reason: string;
  idempotencyReference: string;
  brokerState: BrokerNormalizedState;
  reconciliation: ReturnType<typeof reconcileBrokerCanonicalState> | null;
  mismatchResolution: MismatchResolutionResult | null;
  canonicalState: CanonicalStateLike;
  appliedExecutionIds: string[];
}

function cloneState(state: CanonicalStateLike): CanonicalStateLike {
  return {
    orders: state.orders.map((order) => ({ ...order })),
    executions: state.executions.map((execution) => ({ ...execution })),
    positions: state.positions.map((position) => ({ ...position })),
  };
}

function outcome(status: BrokerOrderStatus["status"]): RecoveryEvidence | null {
  if (["ACK", "OPEN", "PARTIALLY_FILLED", "FILLED"].includes(status)) return "BROKER_CONFIRMED";
  if (["REJECTED", "CANCELLED"].includes(status)) return "BROKER_REJECTED";
  return null;
}

function canonicalStatus(status: BrokerOrderStatus["status"]): string {
  return ({ ACK: "pending", OPEN: "open", PARTIALLY_FILLED: "partially_filled", FILLED: "filled", REJECTED: "rejected", CANCELLED: "cancelled" } as Record<string, string>)[status] ?? "unknown";
}

function findOrder(state: CanonicalStateLike, accountId: string, brokerOrderId: string, clientOrderId?: string | null): CanonicalOrderLike | null {
  return state.orders.find((order) => order.accountId === accountId && (order.brokerOrderId === brokerOrderId || (!!clientOrderId && order.clientOrderId === clientOrderId))) ?? null;
}

function accountOwned(state: CanonicalStateLike, accountId: string, ownerUserId: string): boolean {
  return [...state.orders, ...state.executions, ...state.positions].every((entry) => entry.accountId !== accountId || entry.ownerUserId == null || entry.ownerUserId === ownerUserId);
}

export class RecoveryWorkflow {
  private readonly completed = new Map<string, RecoveryResult>();

  constructor(private readonly brokerRuntime: BrokerRuntime) {}

  async recover(request: RecoveryRequest): Promise<RecoveryResult> {
    const reference = request.recoveryReference ?? `${request.accountId}:${request.brokerOrderId}:${request.clientOrderId ?? ""}`;
    const previous = this.completed.get(reference);
    if (previous) return { ...previous, canonicalState: cloneState(previous.canonicalState), brokerState: previous.brokerState };
    const baseState = cloneState(request.canonicalState);
    const unresolved = (evidence: RecoveryEvidence, reason: string, brokerState: BrokerNormalizedState = normalizeBrokerState({})): RecoveryResult => {
      const result: RecoveryResult = {
        recoveryReference: reference,
        status: "UNRESOLVED",
        evidence,
        reason,
        idempotencyReference: reference,
        brokerState,
        reconciliation: null,
        mismatchResolution: null,
        canonicalState: baseState,
        appliedExecutionIds: [],
      };
      this.completed.set(reference, result);
      return result;
    };

    if (!request.accountId || !request.authUserId || !request.brokerOrderId) return unresolved("INSUFFICIENT_EVIDENCE", "Account, authenticated owner, and broker order identity are required.");
    if (request.riskAllowed === false) return unresolved("INSUFFICIENT_EVIDENCE", "Risk controls do not permit recovery changes.");
    if (!accountOwned(baseState, request.accountId, request.authUserId)) return unresolved("INSUFFICIENT_EVIDENCE", "Canonical state ownership does not match the authenticated account.");

    let status: BrokerOrderStatus | null;
    try {
      status = await this.brokerRuntime.getBrokerOrderStatus(request.brokerOrderId, request.accountId, request.authUserId);
    } catch {
      return unresolved("BROKER_UNAVAILABLE", "Authoritative broker read failed.");
    }
    if (!status) return unresolved("BROKER_UNAVAILABLE", "Authoritative broker state is temporarily unavailable.");
    const evidence = outcome(status.status);
    const brokerState = normalizeBrokerState({
      orders: [{ orderId: status.brokerOrderId, brokerOrderId: status.brokerOrderId, clientOrderId: status.clientOrderId ?? request.clientOrderId, accountId: request.accountId, symbol: status.fills[0]?.symbol ?? "UNKNOWN", side: status.fills[0]?.side ?? "BUY", quantity: status.fills.reduce((total, fill) => total + fill.quantity, 0), filledQuantity: status.fills.reduce((total, fill) => total + fill.quantity, 0), status: status.status }],
      executions: status.fills.map((fill) => ({ id: fill.brokerExecutionId, orderId: fill.brokerOrderId, externalExecutionId: fill.brokerExecutionId, accountId: request.accountId, symbol: fill.symbol, side: fill.side, quantity: fill.quantity, price: fill.price, executedAt: fill.executedAt })),
    });
    const reconciliation = reconcileBrokerCanonicalState({ brokerState, canonicalState: baseState });
    const existingOrder = findOrder(baseState, request.accountId, request.brokerOrderId, status.clientOrderId ?? request.clientOrderId);
    const mismatchResolution = resolveBrokerCanonicalMismatch({
      mismatchReference: reference,
      mismatchType: evidence ? (existingOrder ? "STATUS_MISMATCH" : "BROKER_ONLY") : "UNRESOLVED",
      accountReference: request.accountId,
      previousCanonicalState: baseState,
      brokerState,
      allowAutoResolution: Boolean(evidence && existingOrder),
      resolutionSupport: "canonical_safe_patch",
      riskContext: { accountId: request.accountId },
    });
    if (!evidence) return unresolved("INSUFFICIENT_EVIDENCE", "Broker returned an unknown outcome; no order is retried and no state is guessed.", brokerState);
    if (!existingOrder) return unresolved("INSUFFICIENT_EVIDENCE", "Broker state is real but cannot be tied to an existing canonical order without guessing.", brokerState);
    const fillOwnershipMismatch = status.fills.some((fill) => fill.accountId !== request.accountId || fill.brokerOrderId !== request.brokerOrderId);
    if (fillOwnershipMismatch) return unresolved("INSUFFICIENT_EVIDENCE", "Broker fill ownership or order identity is inconsistent.", brokerState);

    const nextState = cloneState(baseState);
    const target = nextState.orders.find((order) => order.id === existingOrder.id)!;
    target.status = canonicalStatus(status.status);
    target.filledQuantity = status.fills.reduce((total, fill) => total + fill.quantity, 0);
    target.brokerOrderId = request.brokerOrderId;
    const appliedExecutionIds: string[] = [];
    for (const fill of status.fills) {
      const executionId = fill.brokerExecutionId;
      const alreadyRecorded = nextState.executions.some((execution) => execution.accountId === request.accountId && (execution.id === executionId || execution.externalExecutionId === executionId));
      if (alreadyRecorded) continue;
      const normalized = this.brokerRuntime.normalizeBrokerExecution(fill);
      const execution: CanonicalExecutionLike = {
        id: executionId,
        orderId: existingOrder.id,
        accountId: request.accountId,
        ownerUserId: request.authUserId,
        symbol: normalized.symbol,
        side: normalized.side,
        quantity: normalized.quantity,
        executionPrice: normalized.price,
        executedAt: normalized.executedAt,
        externalExecutionId: executionId,
        instrumentId: target.instrumentId,
      };
      nextState.executions.push(execution);
      appliedExecutionIds.push(executionId);
    }
    const result: RecoveryResult = {
      recoveryReference: reference,
      status: "COMPLETED",
      evidence,
      reason: "Authoritative broker evidence safely reconciled into the existing canonical order and executions.",
      idempotencyReference: reference,
      brokerState,
      reconciliation,
      mismatchResolution,
      canonicalState: nextState,
      appliedExecutionIds,
    };
    this.completed.set(reference, result);
    return result;
  }
}