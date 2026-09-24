export type OperationsEventCategory =
  | "MARKET_DATA"
  | "ORDER_UPDATE"
  | "EXECUTION"
  | "POSITION_UPDATE"
  | "PNL_UPDATE"
  | "RISK_EVENT"
  | "ACCOUNT_UPDATE"
  | "RECONCILIATION"
  | "CONNECTION_STATUS";

export interface OperationsEvent<TPayload = unknown> {
  id: string;
  category: OperationsEventCategory;
  accountId?: string;
  occurredAt: string;
  payload: TPayload;
}

export interface OperationsEventBus {
  publish<TPayload>(event: Omit<OperationsEvent<TPayload>, "id"> & { id?: string }): boolean;
  subscribe<TPayload>(listener: (event: OperationsEvent<TPayload>) => void, accountId?: string): () => void;
  clear(): void;
}

function eventKey(event: OperationsEvent): string {
  return event.id || `${event.category}:${event.accountId ?? "global"}:${event.occurredAt}`;
}

export function createOperationsEventBus(): OperationsEventBus {
  const listeners = new Set<(event: OperationsEvent<unknown>) => void>();
  const processed = new Set<string>();

  return {
    publish(event) {
      const normalized = { ...event, id: event.id ?? `${event.category}:${event.accountId ?? "global"}:${event.occurredAt}` } as OperationsEvent;
      const key = eventKey(normalized);
      if (processed.has(key)) return false;
      processed.add(key);
      listeners.forEach((listener) => listener(normalized));
      return true;
    },
    subscribe(listener, accountId) {
      const scopedListener = (event: OperationsEvent<unknown>) => {
        if (accountId && event.accountId !== accountId) return;
        (listener as unknown as (event: OperationsEvent<unknown>) => void)(event);
      };
      listeners.add(scopedListener);
      return () => listeners.delete(scopedListener);
    },
    clear() {
      processed.clear();
    },
  };
}

export const operationsEventBus = createOperationsEventBus();
