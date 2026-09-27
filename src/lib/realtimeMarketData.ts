import type { Instrument } from "./localDatabase";
import { InstrumentMaster } from "./instrumentMaster";

export type RealtimeConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed" | "error";
export type RealtimeQuoteFreshness = "fresh" | "stale";

export interface RealtimeProviderPayload {
  providerInstrumentId?: string | number;
  securityId?: string | number;
  instrumentToken?: string | number;
  exchangeSegment?: string;
  symbol?: string;
  providerTimestamp?: number;
  timestamp?: number;
  ltt?: number;
  ltp?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  prevClose?: number;
  volume?: number;
  oi?: number;
}

export interface CanonicalRealtimeQuote {
  instrumentId: string;
  provider: string;
  providerInstrumentId: string;
  exchange: string;
  exchangeSegment: string;
  symbol: string;
  providerTimestamp: number;
  ltp?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  prevClose?: number;
  volume?: number;
  oi?: number;
  freshness: RealtimeQuoteFreshness;
}

export type RealtimeQuoteListener = (quote: CanonicalRealtimeQuote) => void;
export type RealtimeStateListener = (state: RealtimeConnectionState, error?: string) => void;

export interface RealtimeProviderTransport {
  subscribe(instruments: Array<{ exchangeSegment: string; providerInstrumentId: string }>): void;
  unsubscribe(instruments: Array<{ exchangeSegment: string; providerInstrumentId: string }>): void;
  connect?(): void;
  disconnect?(): void;
}

function providerId(payload: RealtimeProviderPayload): string {
  const value = payload.providerInstrumentId ?? payload.securityId ?? payload.instrumentToken;
  return value == null ? "" : String(value).trim();
}

function finiteOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function timestamp(payload: RealtimeProviderPayload): number | undefined {
  const explicit = finiteOptional(payload.providerTimestamp) ?? finiteOptional(payload.timestamp);
  if (explicit && explicit > 0) return explicit;
  const ltt = finiteOptional(payload.ltt);
  return ltt && ltt > 0 ? ltt * 1000 : undefined;
}

export function normalizeRealtimeQuote(
  master: InstrumentMaster,
  provider: string,
  payload: RealtimeProviderPayload,
): { quote?: CanonicalRealtimeQuote; error?: string } {
  const providerInstrumentId = providerId(payload);
  if (!providerInstrumentId) return { error: "Realtime payload is missing provider instrument identifier." };
  const instrument = master.getByProviderId(provider, providerInstrumentId);
  if (!instrument) return { error: `Unknown ${provider} instrument ${providerInstrumentId}.` };
  const providerTimestamp = timestamp(payload);
  if (!providerTimestamp) return { error: "Realtime payload is missing provider timestamp." };

  const ltp = finiteOptional(payload.ltp);
  if (ltp !== undefined && ltp <= 0) return { error: "Realtime payload contains an invalid LTP." };
  const exchangeSegment = payload.exchangeSegment?.trim() || instrument.exchangeSegment;
  if (exchangeSegment !== instrument.exchangeSegment) return { error: "Realtime payload exchange segment does not match the instrument master." };

  return {
    quote: {
      instrumentId: instrument.securityId,
      provider,
      providerInstrumentId,
      exchange: instrument.exchange,
      exchangeSegment,
      symbol: payload.symbol?.trim() || instrument.symbol,
      providerTimestamp,
      ltp,
      change: finiteOptional(payload.change),
      changePercent: finiteOptional(payload.changePercent),
      open: finiteOptional(payload.open),
      high: finiteOptional(payload.high),
      low: finiteOptional(payload.low),
      close: finiteOptional(payload.close),
      prevClose: finiteOptional(payload.prevClose),
      volume: finiteOptional(payload.volume),
      oi: finiteOptional(payload.oi),
      freshness: "fresh",
    },
  };
}

export class RealtimeMarketDataService {
  private readonly master: InstrumentMaster;
  private readonly transport?: RealtimeProviderTransport;
  private readonly listeners = new Map<string, Set<RealtimeQuoteListener>>();
  private readonly latest = new Map<string, CanonicalRealtimeQuote>();
  private readonly fingerprints = new Map<string, string>();
  private readonly timestamps = new Map<string, number>();
  private readonly stateListeners = new Set<RealtimeStateListener>();
  private readonly providerSubscriptions = new Set<string>();
  private connectionState: RealtimeConnectionState = "disconnected";
  private connectionError?: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private connectionGeneration = 0;
  private restoredGeneration = new Set<string>();
  private failedRestores = new Set<string>();
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelaysMs: number[];

  constructor(instruments: Instrument[] = [], transport?: RealtimeProviderTransport, options: { maxReconnectAttempts?: number; reconnectDelaysMs?: number[] } = {}) {
    this.master = new InstrumentMaster();
    this.master.addAll(instruments);
    this.transport = transport;
    this.maxReconnectAttempts = Math.max(0, options.maxReconnectAttempts ?? 3);
    this.reconnectDelaysMs = options.reconnectDelaysMs?.length ? options.reconnectDelaysMs : [100, 250, 500];
  }

  addInstruments(instruments: Instrument[]): void { this.master.addAll(instruments); }
  get state(): RealtimeConnectionState { return this.connectionState; }
  get error(): string | undefined { return this.connectionError; }
  getLatest(instrumentId: string): CanonicalRealtimeQuote | undefined { return this.latest.get(instrumentId); }
  getSubscriberCount(instrumentId: string): number { return this.listeners.get(instrumentId)?.size ?? 0; }
  get activeSubscriptionIds(): string[] { return [...this.listeners.keys()]; }
  get failedRestoreIds(): string[] { return [...this.failedRestores]; }
  get hasReconnectTimer(): boolean { return this.reconnectTimer !== undefined; }
  get reconnectAttemptCount(): number { return this.reconnectAttempt; }

  onState(listener: RealtimeStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.connectionState, this.connectionError);
    return () => this.stateListeners.delete(listener);
  }

  setState(state: RealtimeConnectionState, error?: string): void {
    this.connectionState = state;
    this.connectionError = error;
    this.stateListeners.forEach((listener) => listener(state, error));
  }

  connect(force = false): void {
    if (!force && (this.connectionState === "connecting" || this.connectionState === "connected" || this.connectionState === "reconnecting")) return;
    this.clearReconnectTimer();
    this.connectionGeneration += 1;
    this.restoredGeneration.clear();
    this.failedRestores.clear();
    this.setState(this.reconnectAttempt > 0 || this.connectionState === "reconnecting" || this.connectionState === "failed" ? "reconnecting" : "connecting");
    try {
      this.transport?.connect?.();
      this.completeConnection(this.connectionGeneration);
    } catch (error) {
      this.failConnection(this.connectionGeneration, error instanceof Error ? error.message : String(error));
    }
  }

  /** Mark the current provider connection lost and begin bounded recovery. */
  connectionLost(error = "Realtime provider connection lost."): void {
    this.connectionGeneration += 1;
    this.restoredGeneration.clear();
    this.setState("reconnecting", error);
    for (const [instrumentId, quote] of this.latest) this.latest.set(instrumentId, { ...quote, freshness: "stale" });
    this.scheduleReconnect();
  }

  /** Explicit recovery from failed or disconnected state. */
  reconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    if (this.connectionState === "connected") return;
    this.setState("reconnecting");
    this.connect(true);
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.connectionGeneration += 1;
    this.restoredGeneration.clear();
    this.failedRestores.clear();
    this.providerSubscriptions.clear();
    this.reconnectAttempt = 0;
    this.transport?.disconnect?.();
    this.setState("disconnected");
  }

  private completeConnection(generation: number): void {
    if (generation !== this.connectionGeneration) return;
    this.restoreSubscriptions(generation);
    if (this.failedRestores.size > 0) {
      this.setState("failed", `Failed to restore ${this.failedRestores.size} subscription(s).`);
      this.scheduleReconnect();
      return;
    }
    this.reconnectAttempt = 0;
    this.setState("connected");
  }

  private restoreSubscriptions(generation: number): void {
    for (const instrumentId of this.listeners.keys()) {
      if (generation !== this.connectionGeneration || this.restoredGeneration.has(instrumentId)) continue;
      const instrument = this.master.getById(instrumentId);
      if (!instrument) continue;
      if (this.providerSubscriptions.has(instrumentId)) {
        this.restoredGeneration.add(instrumentId);
        this.failedRestores.delete(instrumentId);
        continue;
      }
      try {
        this.transport?.subscribe([{ exchangeSegment: instrument.exchangeSegment, providerInstrumentId: instrument.providerInstrumentId }]);
        this.providerSubscriptions.add(instrumentId);
        this.restoredGeneration.add(instrumentId);
        this.failedRestores.delete(instrumentId);
      } catch {
        this.failedRestores.add(instrumentId);
      }
    }
  }

  private failConnection(generation: number, error: string): void {
    if (generation !== this.connectionGeneration) return;
    this.setState("reconnecting", error);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.setState("failed", this.connectionError ?? "Realtime reconnect attempts exhausted.");
      return;
    }
    const delay = this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectionState = "disconnected";
      this.connect(true);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  subscribe(instrumentId: string, listener: RealtimeQuoteListener): () => void {
    const instrument = this.master.getById(instrumentId);
    if (!instrument) throw new Error(`Unknown canonical instrument ${instrumentId}.`);
    const subscribers = this.listeners.get(instrumentId) ?? new Set<RealtimeQuoteListener>();
    const wasEmpty = subscribers.size === 0;
    subscribers.add(listener);
    this.listeners.set(instrumentId, subscribers);
    if (wasEmpty) {
      try {
        if (!this.providerSubscriptions.has(instrumentId)) {
          this.transport?.subscribe([{ exchangeSegment: instrument.exchangeSegment, providerInstrumentId: instrument.providerInstrumentId }]);
          this.providerSubscriptions.add(instrumentId);
        }
      } catch {
        this.failedRestores.add(instrumentId);
      }
      if (this.connectionState === "connected") this.restoredGeneration.add(instrumentId);
    }
    const cached = this.latest.get(instrumentId);
    if (cached) listener(cached);
    return () => this.unsubscribe(instrumentId, listener);
  }

  unsubscribe(instrumentId: string, listener: RealtimeQuoteListener): void {
    const subscribers = this.listeners.get(instrumentId);
    if (!subscribers?.delete(listener)) return;
    if (subscribers.size > 0) return;
    this.listeners.delete(instrumentId);
    this.restoredGeneration.delete(instrumentId);
    this.failedRestores.delete(instrumentId);
    this.providerSubscriptions.delete(instrumentId);
    const instrument = this.master.getById(instrumentId);
    if (instrument) this.transport?.unsubscribe([{ exchangeSegment: instrument.exchangeSegment, providerInstrumentId: instrument.providerInstrumentId }]);
  }

  ingest(provider: string, payload: RealtimeProviderPayload, generation = this.connectionGeneration): { quote?: CanonicalRealtimeQuote; error?: string; ignored?: boolean } {
    if (generation !== this.connectionGeneration) return { ignored: true };
    const normalized = normalizeRealtimeQuote(this.master, provider, payload);
    if (!normalized.quote) return normalized;
    const quote = normalized.quote;
    const fingerprint = JSON.stringify(quote);
    const previousTimestamp = this.timestamps.get(quote.instrumentId);
    if (previousTimestamp !== undefined && quote.providerTimestamp < previousTimestamp) return { ignored: true };
    if (this.fingerprints.get(quote.instrumentId) === fingerprint) return { ignored: true };
    this.timestamps.set(quote.instrumentId, quote.providerTimestamp);
    this.fingerprints.set(quote.instrumentId, fingerprint);
    this.latest.set(quote.instrumentId, { ...quote, freshness: "fresh" });
    this.listeners.get(quote.instrumentId)?.forEach((listener) => listener(this.latest.get(quote.instrumentId)!));
    return { quote: this.latest.get(quote.instrumentId) };
  }
}