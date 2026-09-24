import { describe, expect, it } from "vitest";
import { createOperationsEventBus } from "@/lib/operationsEventBus";

describe("operations event bus", () => {
  it("deduplicates event ids and scopes listeners to an account", () => {
    const bus = createOperationsEventBus();
    const accountEvents: string[] = [];
    const globalEvents: string[] = [];

    bus.subscribe((event) => globalEvents.push(event.id));
    bus.subscribe((event) => accountEvents.push(event.id), "acct-1");

    const event = {
      id: "execution-1",
      category: "EXECUTION" as const,
      accountId: "acct-1",
      occurredAt: "2026-09-22T09:15:00.000Z",
      payload: { quantity: 2 },
    };

    expect(bus.publish(event)).toBe(true);
    expect(bus.publish(event)).toBe(false);
    expect(bus.publish({ ...event, id: "execution-2", accountId: "acct-2" })).toBe(true);
    expect(globalEvents).toEqual(["execution-1", "execution-2"]);
    expect(accountEvents).toEqual(["execution-1"]);
  });

  it("allows a fresh processing window after clear", () => {
    const bus = createOperationsEventBus();
    const received: string[] = [];
    bus.subscribe((event) => received.push(event.id));
    const event = {
      id: "tick-1",
      category: "MARKET_DATA" as const,
      occurredAt: "2026-09-22T09:15:00.000Z",
      payload: { symbol: "NIFTY", price: 23050 },
    };

    expect(bus.publish(event)).toBe(true);
    bus.clear();
    expect(bus.publish(event)).toBe(true);
    expect(received).toEqual(["tick-1", "tick-1"]);
  });

  it("ignores old-account events after switching the active subscription", () => {
    const bus = createOperationsEventBus();
    const received: string[] = [];
    const unsubscribeAccountA = bus.subscribe((event) => received.push(event.id), "acct-a");

    bus.publish({ id: "a-1", category: "POSITION_UPDATE", accountId: "acct-a", occurredAt: "2026-09-22T09:15:00.000Z", payload: {} });
    unsubscribeAccountA();
    bus.subscribe((event) => received.push(event.id), "acct-b");
    bus.publish({ id: "a-2", category: "POSITION_UPDATE", accountId: "acct-a", occurredAt: "2026-09-22T09:16:00.000Z", payload: {} });
    bus.publish({ id: "b-1", category: "POSITION_UPDATE", accountId: "acct-b", occurredAt: "2026-09-22T09:16:00.000Z", payload: {} });

    expect(received).toEqual(["a-1", "b-1"]);
  });
});
