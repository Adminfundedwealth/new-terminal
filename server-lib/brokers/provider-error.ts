import type { MarketDataProviderId } from "./types.js";

export type MarketDataProviderErrorCode =
  | "MISSING_CREDENTIALS"
  | "INVALID_CREDENTIALS"
  | "INVALID_INSTRUMENT"
  | "INVALID_REQUEST"
  | "UPSTREAM_ERROR"
  | "RATE_LIMIT";

export class MarketDataProviderError extends Error {
  constructor(
    public readonly provider: MarketDataProviderId,
    public readonly code: MarketDataProviderErrorCode,
    public readonly upstreamStatus?: number
  ) {
    super(`[${provider.toUpperCase()}] ${code}${upstreamStatus ? ` (HTTP ${upstreamStatus})` : ""}`);
    this.name = "MarketDataProviderError";
  }
}
