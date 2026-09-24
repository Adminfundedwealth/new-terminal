export type OIDataStatus = "LIVE" | "HISTORICAL" | "LOADING" | "UNAVAILABLE" | "ERROR";

export interface OIDataState {
  status: OIDataStatus;
  badge: string;
  title: string;
  description: string;
  showRetry: boolean;
}

export function isMeaningfulMarketValue(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function hasMeaningfulMarketSnapshot(snapshot: {
  ltp?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
}): boolean {
  return isMeaningfulMarketValue(snapshot.ltp)
    || isMeaningfulMarketValue(snapshot.open)
    || isMeaningfulMarketValue(snapshot.high)
    || isMeaningfulMarketValue(snapshot.low)
    || isMeaningfulMarketValue(snapshot.volume);
}

export function resolveOIDataState(params: {
  isLive?: boolean;
  afterHours?: boolean;
  hasData: boolean;
  isLoading: boolean;
  marketIsOpen?: boolean | null;
  unsupported?: boolean;
  errorMessage?: string | null;
}): OIDataState {
  const marketClosed = params.marketIsOpen === false;

  if (params.isLive) {
    return {
      status: "LIVE",
      badge: "LIVE",
      title: "OI Analysis",
      description: "Real-time option-chain data",
      showRetry: false,
    };
  }

  if ((params.afterHours || marketClosed) && params.hasData) {
    return {
      status: "HISTORICAL",
      badge: "HISTORICAL",
      title: "OI Analysis",
      description: "Market closed — showing last available option-chain snapshot.",
      showRetry: false,
    };
  }

  if (params.isLoading && !params.hasData) {
    return {
      status: "LOADING",
      badge: "LOADING",
      title: "Loading option-chain data",
      description: "Request in progress.",
      showRetry: false,
    };
  }

  if (params.errorMessage) {
    return {
      status: "ERROR",
      badge: "ERROR",
      title: "Unable to retrieve option-chain data",
      description: params.errorMessage,
      showRetry: true,
    };
  }

  if (params.unsupported) {
    return {
      status: "UNAVAILABLE",
      badge: "UNAVAILABLE",
      title: "Option-chain data unavailable",
      description: "This provider does not expose the required option-chain fields.",
      showRetry: false,
    };
  }

  return {
    status: "UNAVAILABLE",
    badge: "UNAVAILABLE",
    title: "No option-chain data available",
    description: "No option-chain or OI data is currently available.",
    showRetry: false,
  };
}
