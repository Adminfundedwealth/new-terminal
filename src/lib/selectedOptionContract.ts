import { classifyInstrument } from "@/lib/instrumentClassification";
import type { Instrument } from "@/lib/localDatabase";

export type OptionContractAction = "chart" | "buy" | "sell";

export interface SelectedOptionContract {
  tradingSymbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  securityId: string;
  exchangeSegment: string;
  lotSize: number;
  instrumentType: string;
}

export function resolveOptionContract(
  instruments: Instrument[],
  selection: Pick<SelectedOptionContract, "underlying" | "expiry" | "strike" | "optionType">,
): Instrument | undefined {
  const matches = instruments.filter((instrument) =>
    classifyInstrument(instrument) === "options" &&
    instrument.expiryDate === selection.expiry &&
    instrument.strikePrice === selection.strike &&
    instrument.optionType?.toUpperCase() === selection.optionType &&
    instrument.symbol.toUpperCase() === selection.underlying.toUpperCase() &&
    Boolean(instrument.securityId && instrument.tradingSymbol && instrument.exchangeSegment && instrument.lotSize > 0),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function createSelectedOptionContract(instrument: Instrument): SelectedOptionContract | undefined {
  const optionType = instrument.optionType?.toUpperCase();
  const strike = instrument.strikePrice;
  if (
    classifyInstrument(instrument) !== "options" ||
    !instrument.tradingSymbol ||
    !instrument.symbol ||
    !instrument.expiryDate ||
    typeof strike !== "number" ||
    !Number.isFinite(strike) ||
    !instrument.securityId ||
    !instrument.exchangeSegment ||
    !Number.isFinite(instrument.lotSize) ||
    instrument.lotSize <= 0 ||
    (optionType !== "CE" && optionType !== "PE")
  ) return undefined;

  return {
    tradingSymbol: instrument.tradingSymbol,
    underlying: instrument.symbol,
    expiry: instrument.expiryDate,
    strike,
    optionType,
    securityId: instrument.securityId,
    exchangeSegment: instrument.exchangeSegment,
    lotSize: instrument.lotSize,
    instrumentType: instrument.instrumentType,
  };
}

export function buildOptionWorkspaceUrl(
  contract: SelectedOptionContract,
  action: OptionContractAction,
): string {
  const params = new URLSearchParams({
    workspace: "options",
    symbol: contract.tradingSymbol,
    contract: contract.tradingSymbol,
    underlying: contract.underlying,
    expiry: contract.expiry,
    strike: String(contract.strike),
    optionType: contract.optionType,
    securityId: contract.securityId,
    exchangeSegment: contract.exchangeSegment,
    lotSize: String(contract.lotSize),
    instrumentType: contract.instrumentType,
  });
  if (action === "buy" || action === "sell") params.set("side", action.toUpperCase());
  params.set("tab", action === "chart" ? "Charts" : action.toUpperCase());
  return `/stocks?${params.toString()}`;
}

export function resolveSelectedOptionFromParams(
  instruments: Instrument[],
  params: URLSearchParams,
): Instrument | undefined {
  const underlying = params.get("underlying");
  const expiry = params.get("expiry");
  const strike = Number(params.get("strike"));
  const optionType = params.get("optionType")?.toUpperCase();
  const securityId = params.get("securityId");
  const tradingSymbol = params.get("contract");
  const exchangeSegment = params.get("exchangeSegment");
  const lotSize = Number(params.get("lotSize"));
  const instrumentType = params.get("instrumentType");
  if (
    !underlying || !expiry || !Number.isFinite(strike) ||
    (optionType !== "CE" && optionType !== "PE") ||
    !securityId || !tradingSymbol || !exchangeSegment ||
    !Number.isFinite(lotSize) || !instrumentType
  ) return undefined;

  return instruments.find((instrument) =>
    instrument.securityId === securityId &&
    instrument.tradingSymbol === tradingSymbol &&
    instrument.symbol === underlying &&
    instrument.expiryDate === expiry &&
    instrument.strikePrice === strike &&
    instrument.optionType?.toUpperCase() === optionType &&
    instrument.exchangeSegment === exchangeSegment &&
    instrument.lotSize === lotSize &&
    instrument.instrumentType === instrumentType &&
    classifyInstrument(instrument) === "options",
  );
}
