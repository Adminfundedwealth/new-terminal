/**
 * APPROVED 55 NSE + BSE INDEX UNIVERSE
 *
 * This is the canonical list of approved indices for the FundedWealth Terminal.
 * The Indices screen, search, watchlist and chart navigation must use only these entries.
 *
 * NSE indices: 30  (segment IDX_I)
 * BSE indices: 25  (segment BSE_IDX)
 * Total:       55
 *
 * Last Updated: 2025-01-01
 */

export interface ApprovedIndex {
  symbol: string;
  displayName: string;
  exchange: "NSE" | "BSE";
  tradingViewSymbol: string;
  segment: "IDX_I" | "BSE_IDX";
  category: "Broad" | "Sectoral" | "Thematic";
}

// ── Approved Index List ──────────────────────────────────────────────────────

export const APPROVED_INDICES: ApprovedIndex[] = [
  // ── NSE (30) ──
  { symbol: "NIFTY",               displayName: "NIFTY 50",               exchange: "NSE", tradingViewSymbol: "NSE:NIFTY50",             segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTYNXT50",          displayName: "NIFTY NEXT 50",          exchange: "NSE", tradingViewSymbol: "NSE:NIFTYNXT50",          segment: "IDX_I", category: "Broad" },
  { symbol: "BANKNIFTY",           displayName: "NIFTY BANK",             exchange: "NSE", tradingViewSymbol: "NSE:BANKNIFTY",           segment: "IDX_I", category: "Sectoral" },
  { symbol: "FINNIFTY",            displayName: "FIN NIFTY",              exchange: "NSE", tradingViewSymbol: "NSE:FINNIFTY",            segment: "IDX_I", category: "Sectoral" },
  { symbol: "INDIAVIX",            displayName: "INDIA VIX",              exchange: "NSE", tradingViewSymbol: "NSE:INDIAVIX",            segment: "IDX_I", category: "Thematic" },
  { symbol: "NIFTYMIDCAP",         displayName: "NIFTY MIDCAP",           exchange: "NSE", tradingViewSymbol: "NSE:NIFTYMIDCAP",         segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTYSMALLCAP50",     displayName: "NIFTY SMALLCAP 50",      exchange: "NSE", tradingViewSymbol: "NSE:NIFTYSMALLCAP50",     segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTYMIDCAP50",       displayName: "NIFTY MIDCAP 50",        exchange: "NSE", tradingViewSymbol: "NSE:NIFTYMIDCAP50",       segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTY100",            displayName: "NIFTY 100",              exchange: "NSE", tradingViewSymbol: "NSE:NIFTY100",            segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTY200",            displayName: "NIFTY 200",              exchange: "NSE", tradingViewSymbol: "NSE:NIFTY200",            segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTY500",            displayName: "NIFTY 500",              exchange: "NSE", tradingViewSymbol: "NSE:NIFTY500",            segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTYMIDCAP100",      displayName: "NIFTY MIDCAP 100",       exchange: "NSE", tradingViewSymbol: "NSE:NIFTYMIDCAP100",      segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTYMIDCAP150",      displayName: "NIFTY MIDCAP 150",       exchange: "NSE", tradingViewSymbol: "NSE:NIFTYMIDCAP150",      segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTYSMALLCAP100",    displayName: "NIFTY SMALLCAP 100",     exchange: "NSE", tradingViewSymbol: "NSE:NIFTYSMALLCAP100",    segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTYSMALLCAP250",    displayName: "NIFTY SMALLCAP 250",     exchange: "NSE", tradingViewSymbol: "NSE:NIFTYSMALLCAP250",    segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTYMICROCAP250",    displayName: "NIFTY MICROCAP 250",     exchange: "NSE", tradingViewSymbol: "NSE:NIFTYMICROCAP250",    segment: "IDX_I", category: "Broad" },
  { symbol: "NIFTYAUTO",           displayName: "NIFTY AUTO",             exchange: "NSE", tradingViewSymbol: "NSE:NIFTYAUTO",           segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYPVTBANK",        displayName: "NIFTY PRIVATE BANK",     exchange: "NSE", tradingViewSymbol: "NSE:NIFTYPVTBANK",        segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYFMCG",           displayName: "NIFTY FMCG",            exchange: "NSE", tradingViewSymbol: "NSE:NIFTYFMCG",           segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYENERGY",         displayName: "NIFTY ENERGY",           exchange: "NSE", tradingViewSymbol: "NSE:NIFTYENERGY",         segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYINFRA",          displayName: "NIFTY INFRA",            exchange: "NSE", tradingViewSymbol: "NSE:NIFTYINFRA",          segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYIT",             displayName: "NIFTY IT",               exchange: "NSE", tradingViewSymbol: "NSE:NIFTYIT",             segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYMEDIA",          displayName: "NIFTY MEDIA",            exchange: "NSE", tradingViewSymbol: "NSE:NIFTYMEDIA",          segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYMETAL",          displayName: "NIFTY METAL",            exchange: "NSE", tradingViewSymbol: "NSE:NIFTYMETAL",          segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYMNC",            displayName: "NIFTY MNC",              exchange: "NSE", tradingViewSymbol: "NSE:NIFTYMNC",            segment: "IDX_I", category: "Thematic" },
  { symbol: "NIFTYPHARMA",         displayName: "NIFTY PHARMA",           exchange: "NSE", tradingViewSymbol: "NSE:NIFTYPHARMA",         segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYPSUBANK",        displayName: "NIFTY PSU BANK",         exchange: "NSE", tradingViewSymbol: "NSE:NIFTYPSUBANK",        segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYREALTY",         displayName: "NIFTY REALTY",           exchange: "NSE", tradingViewSymbol: "NSE:NIFTYREALTY",         segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYSRVCSECTOR",     displayName: "NIFTY SERVICES SECTOR",  exchange: "NSE", tradingViewSymbol: "NSE:NIFTYSRVCSECTOR",     segment: "IDX_I", category: "Sectoral" },
  { symbol: "NIFTYCONSUMPTION",    displayName: "NIFTY CONSUMPTION",      exchange: "NSE", tradingViewSymbol: "NSE:NIFTYCONSUMPTION",    segment: "IDX_I", category: "Thematic" },

  // ── BSE (25) ──
  { symbol: "SENSEX",    displayName: "SENSEX",                 exchange: "BSE", tradingViewSymbol: "BSE:SENSEX",    segment: "BSE_IDX", category: "Broad" },
  { symbol: "BSE100",    displayName: "BSE 100",                exchange: "BSE", tradingViewSymbol: "BSE:BSE100",    segment: "BSE_IDX", category: "Broad" },
  { symbol: "BSE200",    displayName: "BSE 200",                exchange: "BSE", tradingViewSymbol: "BSE:BSE200",    segment: "BSE_IDX", category: "Broad" },
  { symbol: "BSE500",    displayName: "BSE 500",                exchange: "BSE", tradingViewSymbol: "BSE:BSE500",    segment: "BSE_IDX", category: "Broad" },
  { symbol: "MIDCAP",    displayName: "BSE 150 MIDCAP",         exchange: "BSE", tradingViewSymbol: "BSE:MIDCAP",    segment: "BSE_IDX", category: "Broad" },
  { symbol: "SMLCAP",    displayName: "BSE 250 SMALL CAP",      exchange: "BSE", tradingViewSymbol: "BSE:SMLCAP",    segment: "BSE_IDX", category: "Broad" },
  { symbol: "LGMIDCAP",  displayName: "BSE 250 LARGE MID",      exchange: "BSE", tradingViewSymbol: "BSE:LGMIDCAP",  segment: "BSE_IDX", category: "Broad" },
  { symbol: "MIDSMCAP",  displayName: "BSE 400 MID SMALL",      exchange: "BSE", tradingViewSymbol: "BSE:MIDSMCAP",  segment: "BSE_IDX", category: "Broad" },
  { symbol: "BANKEX",    displayName: "BSE BANKEX",             exchange: "BSE", tradingViewSymbol: "BSE:BANKEX",    segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "AUTO",      displayName: "BSE AUTO",               exchange: "BSE", tradingViewSymbol: "BSE:AUTO",      segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "CPSE",      displayName: "BSE CAPITAL GOODS",      exchange: "BSE", tradingViewSymbol: "BSE:CPSE",      segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "CDGS",      displayName: "BSE CONSUMER DURABLES",  exchange: "BSE", tradingViewSymbol: "BSE:CDGS",      segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "ENERGY",    displayName: "BSE ENERGY",             exchange: "BSE", tradingViewSymbol: "BSE:ENERGY",    segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "FINANCE",   displayName: "BSE FINANCE",            exchange: "BSE", tradingViewSymbol: "BSE:FINANCE",   segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "FMCG",      displayName: "BSE FMCG",               exchange: "BSE", tradingViewSymbol: "BSE:FMCG",      segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "HEALTHCARE",displayName: "BSE HEALTHCARE",         exchange: "BSE", tradingViewSymbol: "BSE:HEALTHCARE",segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "INDMFG",    displayName: "BSE INDIA MANUFACTURING",exchange: "BSE", tradingViewSymbol: "BSE:INDMFG",    segment: "BSE_IDX", category: "Thematic" },
  { symbol: "INDSTR",    displayName: "BSE INDUSTRIALS",        exchange: "BSE", tradingViewSymbol: "BSE:INDSTR",    segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "IPO",       displayName: "BSE IPO",                exchange: "BSE", tradingViewSymbol: "BSE:IPO",       segment: "BSE_IDX", category: "Thematic" },
  { symbol: "IT",        displayName: "BSE IT",                 exchange: "BSE", tradingViewSymbol: "BSE:IT",        segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "METAL",     displayName: "BSE METALS",             exchange: "BSE", tradingViewSymbol: "BSE:METAL",     segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "OILGAS",    displayName: "BSE OIL AND GAS",        exchange: "BSE", tradingViewSymbol: "BSE:OILGAS",    segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "POWER",     displayName: "BSE POWER",              exchange: "BSE", tradingViewSymbol: "BSE:POWER",     segment: "BSE_IDX", category: "Sectoral" },
  { symbol: "PSU",       displayName: "BSE PSU",                exchange: "BSE", tradingViewSymbol: "BSE:PSU",       segment: "BSE_IDX", category: "Thematic" },
  { symbol: "TECK",      displayName: "BSE TELECOM",            exchange: "BSE", tradingViewSymbol: "BSE:TECK",      segment: "BSE_IDX", category: "Sectoral" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const _approvedSymbolSet = new Set(
  APPROVED_INDICES.map((entry) => entry.symbol.toUpperCase()),
);

/**
 * Returns true if `symbol` matches any approved index (case-insensitive).
 */
export function isApprovedIndex(symbol: string): boolean {
  return _approvedSymbolSet.has(symbol.toUpperCase());
}

/**
 * Returns the ApprovedIndex entry for `symbol`, or undefined if not approved.
 */
export function getApprovedIndexBySymbol(symbol: string): ApprovedIndex | undefined {
  const upper = symbol.toUpperCase();
  return APPROVED_INDICES.find((entry) => entry.symbol.toUpperCase() === upper);
}
