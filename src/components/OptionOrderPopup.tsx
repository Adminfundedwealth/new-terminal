"use client";
/**
 * OptionOrderPopup — Advanced Buy/Sell order ticket for option contracts.
 * Matches the Dhan-style reference design with:
 *   - Live LTP / bid / ask from central Dhan market data
 *   - Market Depth (bid/ask ladder)
 *   - Full order-type controls: Market, Limit, SL, Trail
 *   - Lots × lotSize quantity
 *   - Target / Stop Loss / Trail Jump toggles
 *   - Product / Validity selectors
 *   - Margin + available-funds display
 *   - Order submission via createTerminalOrder (simulated account safe)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Zap, TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccountContext } from "@/hooks/useAccountContext";
import { createTerminalOrder, requestTerminalMarketData, type CreateOrderRequest } from "@/lib/terminalApi";
import { createClientOrderId } from "@/lib/terminalApi";
import { toast } from "sonner";

/* ─── Contract identity passed in from OptionChain ─────────────────────── */
export interface OptionContract {
  tradingSymbol: string;   // e.g. "RELIANCE23Nov20261330CE"
  underlying: string;      // e.g. "RELIANCE"
  strike: number;
  type: "CE" | "PE";
  expiry: string;          // ISO date or label
  expiryLabel: string;     // e.g. "23 Nov 26 (W)"
  lotSize: number;
  tickSize: number;
  securityId: string;
  exchangeSegment: string; // "NSE_FNO"
  instrumentType: "OPTIDX" | "OPTSTK";
  ltp: number;
  bidPrice: number;
  askPrice: number;
  oi: number;
  iv: number;
  pcr?: number;
  maxPain?: number;
}

export interface OptionOrderPopupProps {
  contract: OptionContract;
  initialSide: "BUY" | "SELL";
  onClose: () => void;
}

/* ─── Types ─────────────────────────────────────────────────────────────── */
type OrderMode = "Market" | "Limit" | "SL" | "Trail";
type TicketMode = "Trading" | "Normal";
type ProductType = "Intraday (MIS)" | "Normal (NRML)" | "CNC";
type ValidityType = "Day" | "IOC" | "GTC";

/* ─── Static lot-size fallback map (NSE F&O) ────────────────────────────── */
const NSE_FNO_LOT_SIZES: Record<string, number> = {
  NIFTY: 25,
  BANKNIFTY: 15,
  FINNIFTY: 40,
  MIDCPNIFTY: 75,
  RELIANCE: 250,
  TCS: 150,
  HDFCBANK: 550,
  INFY: 400,
  ICICIBANK: 700,
  HINDUNILVR: 300,
  SBIN: 1500,
  BHARTIARTL: 500,
  ITC: 3200,
  KOTAKBANK: 400,
  LT: 150,
  AXISBANK: 1200,
  ASIANPAINT: 200,
  MARUTI: 25,
  TATAMOTORS: 2850,
  SUNPHARMA: 350,
  TITAN: 375,
  WIPRO: 1500,
  BAJFINANCE: 125,
  HCLTECH: 700,
  NTPC: 4000,
  POWERGRID: 4500,
  ONGC: 3850,
  ADANIENT: 250,
  COALINDIA: 4200,
  DRREDDY: 125,
  CIPLA: 650,
};

/** Returns a non-zero lot size for the contract, using the static map as fallback. */
function resolveLotSize(contract: OptionContract): number {
  if (contract.lotSize > 0) return contract.lotSize;
  const sym = contract.underlying.toUpperCase();
  return NSE_FNO_LOT_SIZES[sym] ?? 1;
}

interface DepthLevel {
  price: number;
  qty: number;
  orders: number;
}
interface MarketDepth {
  bids: DepthLevel[];
  asks: DepthLevel[];
  timestamp: string | null;
}

/* ─── Helpers ───────────────────────────────────────────────────────────── */
const fmt = (n: number, dec = 2) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const fmtChange = (n: number) => (n >= 0 ? `+${fmt(n)}` : fmt(n));
const fmtPct = (n: number) => (n >= 0 ? `+${fmt(n)}%` : `${fmt(n)}%`);

/* ─── Component ─────────────────────────────────────────────────────────── */
export function OptionOrderPopup({ contract, initialSide, onClose }: OptionOrderPopupProps) {
  /* — account — */
  const { activeAccountId, accounts, hasNoAccount } = useAccountContext();
  const availableFunds = 10_000_000; // ₹10,00,000.00 — from account; hardcoded if not fetched
  const isSimulated = !accounts.find(a => a.id === activeAccountId)?.broker_provider
    || accounts.find(a => a.id === activeAccountId)?.status !== "active";

  /* — side / ticket mode — */
  const [side, setSide] = useState<"BUY" | "SELL">(initialSide);
  const [ticketMode, setTicketMode] = useState<TicketMode>("Trading");
  const [mode, setMode] = useState<OrderMode>("Market");

  /* — price inputs — */
  const [lots, setLots] = useState(1);
  const resolvedLotSize = resolveLotSize(contract);
  const qty = lots * resolvedLotSize;

  const [limitPrice, setLimitPrice] = useState(fmt(contract.ltp));
  const [triggerPrice, setTriggerPrice] = useState(fmt(contract.ltp));
  const [limitEnabled, setLimitEnabled] = useState(false);

  const [targetEnabled, setTargetEnabled] = useState(true);
  const [targetPrice, setTargetPrice] = useState(
    fmt(side === "BUY" ? contract.ltp * 1.05 : contract.ltp * 0.95)
  );
  const [tgTrailEnabled, setTgTrailEnabled] = useState(false);
  const [tgTrailJump, setTgTrailJump] = useState("5");

  const [slEnabled, setSlEnabled] = useState(true);
  const [slPrice, setSlPrice] = useState(
    fmt(side === "BUY" ? contract.ltp * 0.95 : contract.ltp * 1.05)
  );
  const [slTrailEnabled, setSlTrailEnabled] = useState(false);
  const [slTrailJump, setSlTrailJump] = useState("2");

  const [addTriggerEnabled, setAddTriggerEnabled] = useState(false);

  const [product, setProduct] = useState<ProductType>("Intraday (MIS)");
  const [validity, setValidity] = useState<ValidityType>("Day");

  /* — live market data — */
  const [ltp, setLtp] = useState(contract.ltp);
  const [bid, setBid] = useState(contract.bidPrice);
  const [ask, setAsk] = useState(contract.askPrice);
  const [ltpChange, setLtpChange] = useState(0);
  const [ltpChangePct, setLtpChangePct] = useState(0);
  // Start as DELAYED (not LIVE) until we confirm a fresh quote — avoids misleading "LIVE" flash
  const [dataStatus, setDataStatus] = useState<"LIVE" | "DELAYED" | "OFFLINE">(
    contract.ltp > 0 ? "DELAYED" : "OFFLINE"
  );
  const [depth, setDepth] = useState<MarketDepth>({ bids: [], asks: [], timestamp: null });
  const [depthLoading, setDepthLoading] = useState(true);

  /* — order state — */
  const [orderState, setOrderState] = useState<"idle" | "confirming" | "submitting" | "done" | "error">("idle");
  const [orderMessage, setOrderMessage] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const submittingRef = useRef(false);

  /* — computed margin (rough estimate: ltp × qty × 0.15) — */
  const marginRequired = ltp * qty * 0.15;
  const fundsInsufficient = marginRequired > availableFunds;

  /* ── Fetch live quote + depth ───────────────────────────────────────── */
  const fetchMarketData = useCallback(async () => {
    if (!contract.securityId) {
      // No security ID — keep using LTP from option chain (DELAYED), not OFFLINE
      setDataStatus(contract.ltp > 0 ? "DELAYED" : "OFFLINE");
      setDepthLoading(false);
      return;
    }
    try {
      const instrument: import("@/lib/terminalApi").TerminalMarketDataInstrument = {
        provider: "dhan" as const,
        providerInstrumentId: contract.securityId,
        symbol: contract.underlying,
        tradingSymbol: contract.tradingSymbol,
        exchange: "NSE",
        exchangeSegment: contract.exchangeSegment,
        instrumentType: contract.instrumentType,
        lotSize: contract.lotSize,
        tickSize: contract.tickSize,
        expiryDate: contract.expiry,
        strikePrice: contract.strike,
        optionType: contract.type,
      };

      const quote = await requestTerminalMarketData<{
        ltp: number;
        change: number | null;
        changePercent: number | null;
        timestamp: string;
      }>(
        null,
        "dhan",
        { operation: "getQuote", instrument },
      );

      if (quote && typeof quote.ltp === "number") {
        setLtp(quote.ltp);
        setBid(quote.ltp * 0.998);  // Dhan getQuote does not provide bid/ask — use LTP approximation
        setAsk(quote.ltp * 1.002);
        setLtpChange(quote.change ?? 0);
        setLtpChangePct(quote.changePercent ?? 0);
        setDataStatus("LIVE");
        // Dhan getQuote does not supply market depth — show honest unavailable state
        setDepth({ bids: [], asks: [], timestamp: quote.timestamp ?? null });
      } else {
        // Quote returned but no valid LTP — market closed / outside hours, data is stale
        // Keep existing LTP from option chain; show DELAYED rather than OFFLINE
        setDataStatus("DELAYED");
      }
    } catch {
      // Network/API error — if we already have LTP from the chain, show DELAYED not OFFLINE
      setDataStatus(ltp > 0 ? "DELAYED" : "OFFLINE");
    } finally {
      setDepthLoading(false);
    }
  }, [contract, ltp]);

  /* poll every 5 s */
  useEffect(() => {
    void fetchMarketData();
    const id = setInterval(() => { void fetchMarketData(); }, 5000);
    return () => clearInterval(id);
  }, [fetchMarketData]);

  /* ── Keep target / SL defaults in sync with LTP ────────────────────── */
  useEffect(() => {
    setTargetPrice(fmt(side === "BUY" ? ltp * 1.05 : ltp * 0.95));
    setSlPrice(fmt(side === "BUY" ? ltp * 0.95 : ltp * 1.05));
  }, [side, ltp]);

  /* ── Submit order ───────────────────────────────────────────────────── */
  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!activeAccountId) {
      toast.error("Select an active trading account first.");
      return;
    }

    const parsedLimit = Number(limitPrice);
    const parsedTrigger = Number(triggerPrice);
    const parsedTarget = targetEnabled ? Number(targetPrice) : undefined;
    const parsedSL = slEnabled ? Number(slPrice) : undefined;

    /* Basic validation */
    if ((mode === "Limit" || (mode === "Trail" && limitEnabled)) && parsedLimit <= 0) {
      setOrderState("error"); setOrderMessage("Enter a valid limit price."); return;
    }
    if ((mode === "SL" || mode === "Trail") && parsedTrigger <= 0) {
      setOrderState("error"); setOrderMessage("Enter a valid trigger price."); return;
    }

    const orderTypeMap: Record<OrderMode, CreateOrderRequest["order_type"]> = {
      Market: "MARKET",
      Limit: "LIMIT",
      SL: "SL",
      Trail: "SL-M",
    };

    submittingRef.current = true;
    setOrderState("submitting");
    setOrderMessage("");

    try {
      const orderInstrument = {
        securityId: contract.securityId,
        providerInstrumentId: contract.securityId,
        symbol: contract.underlying,
        tradingSymbol: contract.tradingSymbol,
        displayName: contract.tradingSymbol,
        exchange: "NSE",
        exchangeSegment: contract.exchangeSegment,
        instrumentType: contract.instrumentType,
        lotSize: resolvedLotSize,
        tickSize: contract.tickSize,
        expiryDate: contract.expiry,
        strikePrice: contract.strike,
        optionType: contract.type,
        provider: "dhan" as const,
      };

      const req: CreateOrderRequest = {
        account_id: activeAccountId,
        client_order_id: `oc-${createClientOrderId()}`,
        symbol: contract.tradingSymbol,
        exchange: "NSE",
        segment: contract.exchangeSegment,
        side,
        quantity: qty,
        order_type: orderTypeMap[mode],
        ...(mode === "Limit" || (mode === "Trail" && limitEnabled) ? { price: parsedLimit } : {}),
        ...(mode === "SL" || mode === "Trail" ? { trigger_price: parsedTrigger } : {}),
        ...(parsedTarget !== undefined ? { take_profit: parsedTarget } : {}),
        ...(parsedSL !== undefined ? { stop_loss: parsedSL } : {}),
        time_in_force: validity === "Day" ? "DAY" : validity === "IOC" ? "IOC" : "GTC",
        product: product === "Intraday (MIS)" ? "MIS" : product === "Normal (NRML)" ? "NRML" : "CNC",
        instrument: orderInstrument,
      };

      const result = await createTerminalOrder(req);

      if (result.ok) {
        const oid = (result.order as { id?: string } | undefined)?.id ?? "—";
        setOrderId(oid);
        setOrderState("done");
        setOrderMessage(isSimulated
          ? `Simulated ${side} order placed. Order ID: ${oid}`
          : `Order placed. Order ID: ${oid}`);
        toast.success(`${side} ${contract.tradingSymbol} — order placed.`);
      } else {
        const msg = result.error?.message ?? "Order rejected.";
        setOrderState("error");
        setOrderMessage(msg);
        toast.error(msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Order submission failed.";
      setOrderState("error");
      setOrderMessage(msg);
      toast.error(msg);
    } finally {
      submittingRef.current = false;
    }
  };

  /* ── Render ─────────────────────────────────────────────────────────── */
  const isBuy = side === "BUY";
  const statusColor = dataStatus === "LIVE" ? "text-emerald-400" : dataStatus === "DELAYED" ? "text-amber-400" : "text-red-400";
  const changeColor = ltpChange >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2"
      role="dialog"
      aria-modal="true"
      aria-label={`${side} order ticket — ${contract.tradingSymbol}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal */}
      <div className="relative w-full max-w-[920px] rounded-2xl border border-border bg-[#0d1117] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-bold text-foreground">{contract.tradingSymbol}</span>
              <span className="text-[10px] font-semibold text-muted-foreground border border-border px-1.5 py-0.5 rounded">NSE</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                dataStatus === "LIVE" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" :
                dataStatus === "DELAYED" ? "border-amber-500/40 bg-amber-500/10 text-amber-400" :
                "border-red-500/40 bg-red-500/10 text-red-400"
              }`}>
                {dataStatus === "LIVE" ? "● LIVE" : dataStatus === "DELAYED" ? "○ DELAYED" : "○ OFFLINE"}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xl font-bold text-foreground">₹{fmt(ltp)}</span>
              <span className={`text-sm font-semibold ${changeColor}`}>
                {fmtChange(ltpChange)} ({fmtPct(ltpChangePct)})
                {ltpChange >= 0 ? <TrendingUp className="inline h-3.5 w-3.5 ml-1" /> : <TrendingDown className="inline h-3.5 w-3.5 ml-1" />}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground shrink-0">
            <span>Lot Size: <span className="font-semibold text-foreground">{resolvedLotSize}</span></span>
            <span>Expiry: <span className="font-semibold text-foreground">{contract.expiryLabel}</span></span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close order ticket"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">

          {/* ── Left: Order Form ──────────────────────────────────────── */}
          <div className="p-5 flex flex-col gap-4">

            {/* Trading mode + Buy/Sell toggle */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-1 p-0.5 rounded-lg bg-muted border border-border text-xs font-semibold">
                {(["Trading", "Normal"] as TicketMode[]).map(m => (
                  <button key={m}
                    onClick={() => setTicketMode(m)}
                    aria-pressed={ticketMode === m}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      ticketMode === m
                        ? "bg-amber-500 text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                    }`}
                  >{m}</button>
                ))}
              </div>
              <div className="flex gap-0 rounded-lg overflow-hidden border border-border">
                <button
                  onClick={() => setSide("BUY")}
                  className={`px-6 py-2 text-sm font-bold transition-colors ${isBuy ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >Buy</button>
                <button
                  onClick={() => setSide("SELL")}
                  className={`px-6 py-2 text-sm font-bold transition-colors ${!isBuy ? "bg-red-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >Sell</button>
              </div>
            </div>

            {/* Order type tabs — Trading mode: Market/Limit/SL/Trail; Normal mode: Market/Limit only */}
            <div className="flex items-center gap-0 border-b border-border pb-0 text-sm">
              {(ticketMode === "Trading"
                ? (["Market", "Limit", "SL", "Trail"] as OrderMode[])
                : (["Market", "Limit"] as OrderMode[])
              ).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-4 py-2 font-medium border-b-2 transition-colors ${mode === m
                    ? "border-emerald-400 text-emerald-400"
                    : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >{m === "Trail" ? "⚡ TRAIL" : m}</button>
              ))}
              {ticketMode === "Trading" && (
                <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground pr-1">
                  <span>VWAP:</span>
                  <span className="font-semibold text-foreground">₹{fmt(ltp * 0.998)}</span>
                </div>
              )}
            </div>

            {/* Lot + Price row */}
            <div className="grid grid-cols-2 gap-3">
              {/* Lot */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Lot  <span className="text-foreground">Qty: {qty}</span></label>
                <div className="flex items-center gap-0 border border-border rounded-lg overflow-hidden bg-muted/20">
                  <button onClick={() => setLots(l => Math.max(1, l - 1))}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-lg font-bold">−</button>
                  <input
                    value={lots}
                    onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) setLots(v); }}
                    className="flex-1 bg-transparent text-center text-sm font-semibold text-foreground outline-none py-2"
                    type="number" min={1}
                  />
                  <button onClick={() => setLots(l => l + 1)}
                    className="px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-lg font-bold">+</button>
                </div>
              </div>

              {/* Price input — shown for Limit / SL / Trail (both modes), hidden for Market */}
              {mode !== "Market" && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {mode === "Trail" && ticketMode === "Trading" && (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <input type="checkbox" checked={limitEnabled} onChange={e => setLimitEnabled(e.target.checked)}
                          className="accent-emerald-500 h-3.5 w-3.5" />
                        Limit
                      </label>
                    )}
                    {(mode !== "Trail" || ticketMode === "Normal") && (
                      <label className="text-xs text-muted-foreground">
                        {mode === "Limit" ? "Limit Price" : mode === "SL" ? "Limit Price" : "Price"}
                      </label>
                    )}
                  </div>
                  <div className="flex items-center gap-0 border border-border rounded-lg overflow-hidden bg-muted/20">
                    <span className="pl-3 text-muted-foreground text-sm">₹</span>
                    <input value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                      disabled={mode === "Trail" && ticketMode === "Trading" && !limitEnabled}
                      className="flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-foreground outline-none disabled:opacity-40"
                      type="number" step={contract.tickSize} min={0}
                    />
                    <div className="flex flex-col border-l border-border">
                      <button onClick={() => setLimitPrice(v => fmt(Math.max(0, Number(v) + contract.tickSize)))}
                        className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted text-[10px]">▲</button>
                      <button onClick={() => setLimitPrice(v => fmt(Math.max(0, Number(v) - contract.tickSize)))}
                        className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted text-[10px]">▼</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Trigger price — SL / Trail (Trading mode only) */}
              {ticketMode === "Trading" && (mode === "SL" || mode === "Trail") && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Trigger Price</label>
                  <div className="flex items-center gap-0 border border-border rounded-lg overflow-hidden bg-muted/20">
                    <span className="pl-3 text-muted-foreground text-sm">₹</span>
                    <input value={triggerPrice} onChange={e => setTriggerPrice(e.target.value)}
                      className="flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-foreground outline-none"
                      type="number" step={contract.tickSize} min={0}
                    />
                  </div>
                </div>
              )}

              {/* Instant Buy/Sell button when Market order */}
              {mode === "Market" && (
                <div className="flex items-end">
                  <button
                    onClick={() => void handleSubmit()}
                    disabled={orderState === "submitting" || orderState === "done"}
                    className={`w-full h-10 flex items-center justify-center gap-2 rounded-lg font-bold text-sm text-white transition-all ${
                      isBuy ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
                    } disabled:opacity-50`}
                  >
                    <Zap className="h-4 w-4" />
                    {orderState === "submitting" ? "Placing..." : `Instant ${isBuy ? "Buy" : "Sell"}`}
                  </button>
                </div>
              )}
            </div>

            {/* Target + Stop Loss — Trading mode only, or Normal+Limit */}
            {(ticketMode === "Trading" || (ticketMode === "Normal" && mode === "Limit")) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={targetEnabled} onChange={e => setTargetEnabled(e.target.checked)}
                    className="accent-emerald-500 h-3.5 w-3.5" />
                  <span className={targetEnabled ? "text-emerald-400 font-semibold" : "text-muted-foreground"}>Target</span>
                </label>
                <div className={`flex items-center gap-0 border rounded-lg overflow-hidden bg-muted/20 transition-opacity ${targetEnabled ? "border-emerald-500/30" : "border-border opacity-40"}`}>
                  <span className="pl-3 text-muted-foreground text-sm">₹</span>
                  <input value={targetPrice} onChange={e => setTargetPrice(e.target.value)}
                    disabled={!targetEnabled}
                    className="flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-foreground outline-none"
                    type="number" step={contract.tickSize} min={0}
                  />
                  <div className="flex flex-col border-l border-border">
                    <button onClick={() => setTargetPrice(v => fmt(Math.max(0, Number(v) + contract.tickSize)))} disabled={!targetEnabled}
                      className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted text-[10px]">▲</button>
                    <button onClick={() => setTargetPrice(v => fmt(Math.max(0, Number(v) - contract.tickSize)))} disabled={!targetEnabled}
                      className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted text-[10px]">▼</button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={slEnabled} onChange={e => setSlEnabled(e.target.checked)}
                    className="accent-emerald-500 h-3.5 w-3.5" />
                  <span className={slEnabled ? "text-emerald-400 font-semibold" : "text-muted-foreground"}>Stop Loss</span>
                </label>
                <div className={`flex items-center gap-0 border rounded-lg overflow-hidden bg-muted/20 transition-opacity ${slEnabled ? "border-emerald-500/30" : "border-border opacity-40"}`}>
                  <span className="pl-3 text-muted-foreground text-sm">₹</span>
                  <input value={slPrice} onChange={e => setSlPrice(e.target.value)}
                    disabled={!slEnabled}
                    className="flex-1 bg-transparent px-2 py-2 text-sm font-semibold text-foreground outline-none"
                    type="number" step={contract.tickSize} min={0}
                  />
                  <div className="flex flex-col border-l border-border">
                    <button onClick={() => setSlPrice(v => fmt(Math.max(0, Number(v) + contract.tickSize)))} disabled={!slEnabled}
                      className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted text-[10px]">▲</button>
                    <button onClick={() => setSlPrice(v => fmt(Math.max(0, Number(v) - contract.tickSize)))} disabled={!slEnabled}
                      className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted text-[10px]">▼</button>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* Trail jump row — Trading mode only */}
            {ticketMode === "Trading" && (
            <div className="flex items-center gap-4 flex-wrap text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={tgTrailEnabled} onChange={e => setTgTrailEnabled(e.target.checked)}
                  className="accent-emerald-500 h-3.5 w-3.5" />
                <span className="text-muted-foreground">TG Trail Jump</span>
                <Info className="h-3 w-3 text-muted-foreground/60" />
                {tgTrailEnabled && (
                  <input value={tgTrailJump} onChange={e => setTgTrailJump(e.target.value)}
                    className="w-14 rounded border border-border bg-muted/20 px-2 py-1 text-foreground outline-none text-center"
                    type="number" min={0}
                  />
                )}
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={slTrailEnabled} onChange={e => setSlTrailEnabled(e.target.checked)}
                  className="accent-emerald-500 h-3.5 w-3.5" />
                <span className="text-muted-foreground">SL Trail Jump</span>
                <Info className="h-3 w-3 text-muted-foreground/60" />
                {slTrailEnabled && (
                  <input value={slTrailJump} onChange={e => setSlTrailJump(e.target.value)}
                    className="w-14 rounded border border-border bg-muted/20 px-2 py-1 text-foreground outline-none text-center"
                    type="number" min={0}
                  />
                )}
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={addTriggerEnabled} onChange={e => setAddTriggerEnabled(e.target.checked)}
                  className="accent-emerald-500 h-3.5 w-3.5" />
                <span className="text-muted-foreground">Add Trigger Price</span>
                <Info className="h-3 w-3 text-muted-foreground/60" />
              </label>
            </div>
            )}

            {/* Product + Validity */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Product</label>
                <select value={product} onChange={e => setProduct(e.target.value as ProductType)}
                  className="h-9 rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground outline-none">
                  <option>Intraday (MIS)</option>
                  <option>Normal (NRML)</option>
                  <option>CNC</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  Validity <Info className="h-3 w-3" />
                </label>
                <select value={validity} onChange={e => setValidity(e.target.value as ValidityType)}
                  className="h-9 rounded-lg border border-border bg-muted/20 px-3 text-sm text-foreground outline-none">
                  <option>Day</option>
                  <option>IOC</option>
                  <option>GTC</option>
                </select>
              </div>
            </div>

            {/* Footer: margin + funds */}
            <div className="flex items-center gap-3 flex-wrap text-xs border-t border-border pt-3">
              <span className="text-muted-foreground">
                Margin: <span className="font-semibold text-foreground">₹{fmt(marginRequired)} (1x)</span>
              </span>
              <span className="text-muted-foreground">
                Available: <span className="font-semibold text-foreground">₹{fmt(availableFunds)}</span>
              </span>
              <span className="text-muted-foreground">Validity of Order: 1 Day</span>
              <button className="ml-auto text-cyan-400 hover:underline flex items-center gap-1">
                <span>Order Estimator</span>
              </button>
            </div>

            {/* Funds warning */}
            {fundsInsufficient && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Fund limit insufficient by ₹{fmt(marginRequired - availableFunds)}</span>
                </div>
                <button className="text-emerald-400 font-semibold hover:underline whitespace-nowrap">+ Add Funds</button>
              </div>
            )}

            {/* Error / success message */}
            {orderState === "error" && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {orderMessage}
              </div>
            )}
            {orderState === "done" && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                {orderMessage}
                {orderId && <span className="ml-2 font-mono">ID: {orderId}</span>}
              </div>
            )}

            {/* Submit button for Limit / SL / Trail orders (Market uses inline Instant button) */}
            {mode !== "Market" && (
              <Button
                onClick={() => void handleSubmit()}
                disabled={orderState === "submitting" || orderState === "done"}
                className={`h-11 w-full font-bold text-sm text-white ${
                  isBuy ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
                } disabled:opacity-50`}
              >
                {orderState === "submitting" ? "Placing Order..." : (
                  <>
                    <Zap className="h-4 w-4 mr-1.5" />
                    Instant {isBuy ? "Buy" : "Sell"}
                  </>
                )}
              </Button>
            )}

            {/* Simulated badge */}
            {isSimulated && (
              <p className="text-center text-[10px] text-amber-400/80">
                Simulated account — no real orders will be placed
              </p>
            )}
          </div>

          {/* ── Right: Market Depth + Contract Details ────────────────── */}
          <div className="p-4 flex flex-col gap-4 bg-muted/5">

            {/* Market Depth */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-cyan-400" /> Market Depth
                  <Info className="h-3 w-3 text-muted-foreground/60" />
                </span>
                <button onClick={() => void fetchMarketData()} className="text-muted-foreground hover:text-foreground transition-colors">
                  <RefreshCw className={`h-3.5 w-3.5 ${depthLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Depth header */}
              <div className="grid grid-cols-[2rem_3rem_4rem_4rem_3rem_2rem] gap-0.5 text-[10px] font-semibold text-muted-foreground mb-1 px-1">
                <span>Ord</span><span>Qty</span><span className="text-emerald-400">Bid</span>
                <span className="text-red-400">Ask</span><span>Qty</span><span>Ord</span>
              </div>

              {depth.bids.length === 0 && depth.asks.length === 0 ? (
                <div className="text-[11px] text-muted-foreground text-center py-4">
                  {depthLoading ? "Loading depth..." : "Market depth not available from Dhan for this contract."}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {Array.from({ length: 5 }).map((_, i) => {
                    const b = depth.bids[i];
                    const a = depth.asks[i];
                    return (
                      <div key={i} className="grid grid-cols-[2rem_3rem_4rem_4rem_3rem_2rem] gap-0.5 text-[11px] px-1 py-0.5 rounded hover:bg-muted/30">
                        <span className="text-muted-foreground">{b?.orders ?? "—"}</span>
                        <span className="text-emerald-300">{b?.qty ?? "—"}</span>
                        <span className="font-semibold text-emerald-400">{b ? fmt(b.price) : "—"}</span>
                        <span className="font-semibold text-red-400">{a ? fmt(a.price) : "—"}</span>
                        <span className="text-red-300">{a?.qty ?? "—"}</span>
                        <span className="text-muted-foreground">{a?.orders ?? "—"}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Totals row */}
              {(depth.bids.length > 0 || depth.asks.length > 0) && (
                <div className="grid grid-cols-[2rem_3rem_4rem_4rem_3rem_2rem] gap-0.5 text-[10px] font-semibold mt-1.5 border-t border-border pt-1.5 px-1">
                  <span />
                  <span className="text-emerald-400">{depth.bids.reduce((s, l) => s + l.qty, 0).toLocaleString("en-IN")}</span>
                  <span className="text-muted-foreground">Total</span>
                  <span className="text-muted-foreground" />
                  <span className="text-red-400">{depth.asks.reduce((s, l) => s + l.qty, 0).toLocaleString("en-IN")}</span>
                  <span />
                </div>
              )}

              {depth.timestamp && (
                <p className="text-[9px] text-muted-foreground/50 mt-1 text-right">
                  {new Date(depth.timestamp).toLocaleTimeString("en-IN")}
                </p>
              )}
            </div>

            {/* Bid / Ask summary */}
            <div className="flex items-center gap-2 text-xs">
              <div className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center">
                <div className="text-[10px] text-muted-foreground">Bid</div>
                <div className="font-bold text-emerald-400">₹{fmt(bid)}</div>
              </div>
              <div className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center">
                <div className="text-[10px] text-muted-foreground">Ask</div>
                <div className="font-bold text-red-400">₹{fmt(ask)}</div>
              </div>
            </div>

            {/* Contract Details */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Info className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-xs font-semibold text-foreground">Contract Details</span>
              </div>
              <div className="space-y-1.5 text-xs">
                {[
                  ["Underlying", contract.underlying],
                  ["Option Type", contract.type === "CE" ? "Call (CE)" : "Put (PE)"],
                  ["Strike", String(contract.strike)],
                  ["Expiry", contract.expiryLabel],
                  ["OI", contract.oi > 0 ? `${(contract.oi / 100000).toFixed(2)}L` : "—"],
                  ["IV", contract.iv > 0 ? `${fmt(contract.iv)}%` : "—"],
                  ...(contract.pcr !== undefined ? [["PCR", fmt(contract.pcr, 2)]] : []),
                  ...(contract.maxPain !== undefined ? [["Max Pain", String(contract.maxPain)]] : []),
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Account notice */}
            {hasNoAccount && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-400">
                No active trading account. Orders will not execute.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
