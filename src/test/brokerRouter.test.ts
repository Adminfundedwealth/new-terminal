import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrokerRouter, DhanAdapter } from "@/lib/brokerRouter";
import { resetKiteInstrumentCache, ZerodhaAdapter } from "@/lib/zerodhaAdapter";
import { AngelOneAdapter } from "@/lib/angelOneAdapter";
import { UpstoxAdapter } from "@/lib/upstoxAdapter";
import { FivePaisaAdapter } from "@/lib/fivePaisaAdapter";
import { FyersAdapter } from "@/lib/fyersAdapter";
import { AliceBlueAdapter } from "@/lib/aliceBlueAdapter";

afterEach(() => {
  vi.unstubAllGlobals();
  resetKiteInstrumentCache();
});

describe("broker router", () => {
  it("selects the active provider without changing terminal business logic", () => {
    const router = createBrokerRouter([{ brokerId: "zerodha", values: {}, addedAt: "", isActive: true }]);
    expect(router.getActiveProvider()).toBe("zerodha");
    expect(router.getAdapter()?.id).toBe("zerodha");
  });

  it("returns explicit unsupported capability results", async () => {
    const router = createBrokerRouter([{ brokerId: "fyers", values: {}, addedAt: "", isActive: true }]);
    const result = await router.getAdapter()!.getQuote("NIFTY");
    expect(result.state).toBe("not_verified");
    expect(result.provider).toBe("fyers");
  });

  it("normalizes a Dhan quote response without claiming authentication", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { IDX_I: [{ last_price: 22000, previous_close: 21900 }] } }), { status: 200 })));
    const result = await new DhanAdapter().getQuote("NIFTY");
    expect(result.state).toBe("not_verified");
    expect(result.data?.ltp).toBe(22000);
    expect(result.data?.change).toBe(100);
  });

  it("reports authentication failure without treating it as connected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "error", message: "credentials missing" }), { status: 200 })));
    const result = await new DhanAdapter().authenticate();
    expect(result.state).toBe("not_verified");
    expect(result.data).toBeUndefined();
  });

  it("never invents order support", async () => {
    const result = await new DhanAdapter().placeOrder({ symbol: "NIFTY" });
    expect(result.state).toBe("not_supported");
  });

  it("reports Kite authentication failure when credentials are absent", async () => {
    const result = await new ZerodhaAdapter({ brokerId: "zerodha", values: {}, addedAt: "", isActive: true }).authenticate();
    expect(result.state).toBe("not_verified");
    expect(result.message).toContain("not configured");
  });

  it("normalizes a documented Kite quote response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { "NSE:INFY": { last_price: 1500, ohlc: { close: 1490 }, timestamp: "2026-09-20 10:00:00" } } }), { status: 200 })));
    const adapter = new ZerodhaAdapter({ brokerId: "zerodha", values: { apiKey: "key", accessToken: "token" }, addedAt: "", isActive: true });
    const result = await adapter.getQuote("INFY");
    expect(result.state).toBe("not_verified");
    expect(result.data?.ltp).toBe(1500);
    expect(result.data?.change).toBe(10);
  });

  it("normalizes Kite order history and exposes option-chain construction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: [{ order_id: "1", tradingsymbol: "INFY", exchange: "NSE", transaction_type: "BUY", quantity: 1, filled_quantity: 0, status: "OPEN", average_price: 0 }] }), { status: 200 })));
    const adapter = new ZerodhaAdapter({ brokerId: "zerodha", values: { apiKey: "key", accessToken: "token" }, addedAt: "", isActive: true });
    const orders = await adapter.getOrderStatus("1");
    expect(orders.data?.[0].orderId).toBe("1");
    expect(adapter.capabilities.optionChain).toBe("not_verified");
    expect((await adapter.getOptionChain("NIFTY")).state).toBe("not_verified");
  });

  it.each([1, 2, 10, 25, 50, 75, 100, 151])("quotes every option contract across safe batches (%i)", async (contractCount) => {
    const instruments = Array.from({ length: contractCount }, (_, index) => ({
      name: "NIFTY",
      tradingsymbol: `NIFTY26SEP${23000 + Math.floor(index / 2)}${index % 2 === 0 ? "CE" : "PE"}`,
      instrument_token: String(1000 + index),
      expiry: "2026-09-24",
      strike: String(23000 + Math.floor(index / 2)),
      lot_size: "65",
      instrument_type: index % 2 === 0 ? "CE" : "PE",
      exchange: "NFO",
    }));
    const requestCalls: Array<{ endpoint: string; params: Record<string, string> }> = [];
    class BatchTestAdapter extends ZerodhaAdapter {
      override async getInstruments() {
        return { provider: "zerodha" as const, capability: "instruments" as const, state: "not_verified" as const, data: instruments.map((item) => ({ symbol: item.name, tradingSymbol: item.tradingsymbol, securityId: item.instrument_token, exchangeSegment: "NFO", instrumentType: item.instrument_type === "CE" || item.instrument_type === "PE" ? "OPTIDX" : item.instrument_type, lotSize: Number(item.lot_size), expiryDate: item.expiry, strikePrice: Number(item.strike), optionType: item.instrument_type })) };
      }
    }
    const adapter = new BatchTestAdapter({ brokerId: "zerodha", values: { apiKey: "batch-test", accessToken: "token" }, addedAt: "", isActive: true });
    (adapter as unknown as { request: (endpoint: string, params: Record<string, string>) => Promise<unknown> }).request = async (endpoint, params) => {
      requestCalls.push({ endpoint, params });
      if (endpoint === "quote" && params.instruments) {
        const data = Object.fromEntries(params.instruments.split(",").map((key) => [key, { last_price: 100, oi: 1000, volume: 50, depth: { buy: [{ price: 99 }], sell: [{ price: 101 }] } }]));
        return { status: "success", data };
      }
      return { status: "success", data: { "NSE:NIFTY 50": { last_price: 23000, timestamp: "2026-09-22 10:00:00" } } };
    };
    const result = await adapter.getOptionChain("NIFTY", "2026-09-24");
    expect(result.data?.chain).toHaveLength(Math.ceil(contractCount / 2));
    expect(result.data?.chain.every((row) => row.ce.ltp === 100)).toBe(true);
    const quoteRequests = requestCalls.filter(({ endpoint, params }) => endpoint === "quote" && Boolean(params.instruments));
    expect(quoteRequests.length).toBe(Math.ceil(contractCount / 75));
  });

  it("reports Angel One missing credentials without authenticating", async () => {
    const result = await new AngelOneAdapter({ brokerId: "angel_one", values: {}, addedAt: "", isActive: true }).authenticate();
    expect(result.state).toBe("not_verified");
    expect(result.message).toContain("API key");
  });

  it("normalizes documented Angel One LTP data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: true, data: { tradingsymbol: "SBIN-EQ", ltp: "191", close: "187.80" } }), { status: 200 })));
    const adapter = new AngelOneAdapter({ brokerId: "angel_one", values: { apiKey: "key", clientId: "client", jwtToken: "jwt" }, addedAt: "", isActive: true });
    const result = await adapter.getQuote("3045");
    expect(result.state).toBe("not_verified");
    expect(result.data?.ltp).toBe(191);
    expect(result.data?.change).toBeCloseTo(3.2);
  });

  it("normalizes Angel One positions and keeps option-chain unsupported", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: true, data: [{ tradingsymbol: "RELIANCE-EQ", exchange: "NSE", netqty: "1", avgnetprice: "2200", ltp: "2210", pnl: "10" }] }), { status: 200 })));
    const adapter = new AngelOneAdapter({ brokerId: "angel_one", values: { apiKey: "key", clientId: "client", jwtToken: "jwt" }, addedAt: "", isActive: true });
    const position = await adapter.getPositions();
    expect(position.data?.[0].symbol).toBe("RELIANCE-EQ");
    expect((await adapter.getOptionChain("NIFTY")).state).toBe("not_supported");
  });

  it("reports Upstox missing credentials without authentication", async () => {
    const result = await new UpstoxAdapter({ brokerId: "upstox", values: {}, addedAt: "", isActive: true }).authenticate();
    expect(result.state).toBe("not_verified");
    expect(result.message).toContain("access token");
  });

  it("normalizes Upstox quote, positions, and option-chain responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.includes("option-chain")) return Promise.resolve(new Response(JSON.stringify({ status: "success", data: [{ expiry: "2026-09-24", underlying_spot_price: 24000, strike_price: 24000 }] }), { status: 200 }));
      if (url.includes("positions")) return Promise.resolve(new Response(JSON.stringify({ status: "success", data: [{ trading_symbol: "NIFTY", exchange: "NSE", quantity: 1, average_price: 100, last_price: 110, pnl: 10 }] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ status: "success", data: { "NSE_EQ|TEST": { last_price: 100 } } }), { status: 200 }));
    }));
      const adapter = new UpstoxAdapter({ brokerId: "upstox", values: { accessToken: "token" }, addedAt: "", isActive: true });
    expect((await adapter.getQuote("NSE_EQ|TEST")).data?.ltp).toBe(100);
    expect((await adapter.getPositions()).data?.[0].pnl).toBe(10);
    expect((await adapter.getOptionChain("NSE_INDEX|Nifty%2050")).data?.spotPrice).toBe(24000);
  });

  it("registers and switches to all remaining providers", async () => {
    const providers = [
      ["dhan", "Dhan"], ["zerodha", "Zerodha/Kite"], ["angel_one", "Angel One/SmartAPI"],
      ["upstox", "Upstox"], ["fivepaisa", "5paisa"], ["fyers", "Fyers"], ["aliceblue", "Alice Blue"],
    ] as const;
    for (const [id, name] of providers) {
      const router = createBrokerRouter([{ brokerId: id, values: {}, addedAt: "", isActive: true }]);
      expect(router.getActiveProvider()).toBe(id);
      expect(router.getAdapter()?.name).toBe(name);
    }
  });

  it("does not capture the active provider before a later selection", () => {
    const configured = [
      { brokerId: "dhan" as const, values: {}, addedAt: "", isActive: true },
      { brokerId: "upstox" as const, values: {}, addedAt: "", isActive: false },
    ];
    const router = createBrokerRouter(configured);
    expect(router.getActiveProvider()).toBe("dhan");
    configured[0].isActive = false;
    configured[1].isActive = true;
    expect(router.getActiveProvider()).toBe("upstox");
    expect(router.getAdapter()?.id).toBe("upstox");
  });

  it("reports missing credentials for 5paisa, Fyers, and Alice Blue", async () => {
    expect((await new FivePaisaAdapter({ brokerId: "fivepaisa", values: {}, addedAt: "", isActive: true }).authenticate()).state).toBe("not_verified");
    expect((await new FyersAdapter({ brokerId: "fyers", values: {}, addedAt: "", isActive: true }).authenticate()).state).toBe("not_verified");
    expect((await new AliceBlueAdapter({ brokerId: "aliceblue", values: {}, addedAt: "", isActive: true }).authenticate()).state).toBe("not_verified");
  });
});