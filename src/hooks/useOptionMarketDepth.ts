import { useQuery } from "@tanstack/react-query";
import type { OptionContract } from "@/components/OptionOrderPopup";
import {
  requestTerminalMarketData,
  TerminalMarketDataError,
  type TerminalMarketDataInstrument,
  type TerminalMarketDepth,
} from "@/lib/terminalApi";

export function optionContractToMarketInstrument(contract: OptionContract): TerminalMarketDataInstrument {
  return {
    provider: "dhan",
    providerInstrumentId: contract.securityId,
    symbol: contract.underlying,
    tradingSymbol: contract.tradingSymbol,
    exchange: contract.exchangeSegment.toUpperCase().startsWith("BSE") ? "BSE" : "NSE",
    exchangeSegment: contract.exchangeSegment,
    instrumentType: contract.instrumentType,
    lotSize: contract.lotSize,
    tickSize: contract.tickSize,
    expiryDate: contract.expiry,
    strikePrice: contract.strike,
    optionType: contract.type,
  };
}

/** Explains a depth failure without implying data exists. */
export function describeDepthError(error: unknown): string {
  if (error instanceof TerminalMarketDataError && error.code === "INVALID_REQUEST") {
    return "Market depth is not enabled on the connected market-data service yet.";
  }
  if (error instanceof TerminalMarketDataError && error.code === "RATE_LIMITED") {
    return "Dhan is rate limiting quote requests. Depth will refresh shortly.";
  }
  return error instanceof Error ? error.message : "Market depth request failed.";
}

export function useMarketDepth(instrument: TerminalMarketDataInstrument | null, enabled: boolean, refetchMs = 5_000) {
  return useQuery({
    queryKey: ["market-depth", instrument?.exchangeSegment, instrument?.providerInstrumentId],
    enabled: enabled && Boolean(instrument && /^\d+$/.test(instrument.providerInstrumentId)),
    queryFn: () => requestTerminalMarketData<TerminalMarketDepth>(null, "dhan", { operation: "getMarketDepth", instrument: instrument! }),
    refetchInterval: (query) => {
      const error = query.state.error;
      if (error instanceof TerminalMarketDataError && error.code === "INVALID_REQUEST") return false;
      return refetchMs;
    },
    staleTime: 2_000,
    retry: false,
  });
}
