export interface CuratedStock {
  symbol: string;
  name: string;
}

export const CURATED_STOCKS: CuratedStock[] = [
  { symbol: "RELIANCE", name: "Reliance Industries" },
  { symbol: "HDFCBANK", name: "HDFC Bank" },
  { symbol: "ICICIBANK", name: "ICICI Bank" },
  { symbol: "SBIN", name: "State Bank of India" },
  { symbol: "AXISBANK", name: "Axis Bank" },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank" },
  { symbol: "BANKBARODA", name: "Bank of Baroda" },
  { symbol: "PNB", name: "Punjab National Bank" },
  { symbol: "CANBK", name: "Canara Bank" },
  { symbol: "INDUSINDBK", name: "IndusInd Bank" },
  { symbol: "TCS", name: "Tata Consultancy Services" },
  { symbol: "INFY", name: "Infosys" },
  { symbol: "HCLTECH", name: "HCL Technologies" },
  { symbol: "WIPRO", name: "Wipro" },
  { symbol: "TECHM", name: "Tech Mahindra" },
  { symbol: "LTIM", name: "LTIMindtree" },
  { symbol: "PERSISTENT", name: "Persistent Systems" },
  { symbol: "COFORGE", name: "Coforge" },
  { symbol: "MPHASIS", name: "Mphasis" },
  { symbol: "OFSS", name: "Oracle Financial Services" },
  { symbol: "ITC", name: "ITC" },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever" },
  { symbol: "NESTLEIND", name: "Nestle India" },
  { symbol: "BRITANNIA", name: "Britannia Industries" },
  { symbol: "TATACONSUM", name: "Tata Consumer Products" },
  { symbol: "VBL", name: "Varun Beverages" },
  { symbol: "DABUR", name: "Dabur India" },
  { symbol: "GODREJCP", name: "Godrej Consumer Products" },
  { symbol: "MARICO", name: "Marico" },
  { symbol: "COLPAL", name: "Colgate-Palmolive" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel" },
  { symbol: "IDEA", name: "Vodafone Idea" },
  { symbol: "INDUSTOWER", name: "Indus Towers" },
  { symbol: "TITAN", name: "Titan Company" },
  { symbol: "ASIANPAINT", name: "Asian Paints" },
  { symbol: "ONGC", name: "ONGC" },
  { symbol: "BPCL", name: "Bharat Petroleum" },
  { symbol: "IOC", name: "Indian Oil Corporation" },
  { symbol: "GAIL", name: "GAIL India" },
  { symbol: "HINDPETRO", name: "Hindustan Petroleum" },
  { symbol: "PETRONET", name: "Petronet LNG" },
  { symbol: "OIL", name: "Oil India" },
  { symbol: "COALINDIA", name: "Coal India" },
  { symbol: "NTPC", name: "NTPC" },
  { symbol: "POWERGRID", name: "Power Grid" },
  { symbol: "TATASTEEL", name: "Tata Steel" },
  { symbol: "JSWSTEEL", name: "JSW Steel" },
  { symbol: "HINDALCO", name: "Hindalco Industries" },
  { symbol: "VEDL", name: "Vedanta" },
  { symbol: "SAIL", name: "Steel Authority of India" },
  { symbol: "JINDALSTEL", name: "Jindal Steel" },
  { symbol: "NMDC", name: "NMDC" },
  { symbol: "NATIONALUM", name: "National Aluminium" },
  { symbol: "ADANIENT", name: "Adani Enterprises" },
  { symbol: "ADANIPORTS", name: "Adani Ports" },
  { symbol: "LT", name: "Larsen & Toubro" },
  { symbol: "BEL", name: "Bharat Electronics" },
  { symbol: "HAL", name: "Hindustan Aeronautics" },
  { symbol: "BHEL", name: "BHEL" },
  { symbol: "RVNL", name: "Rail Vikas Nigam" },
  { symbol: "IRFC", name: "IRFC" },
  { symbol: "PFC", name: "Power Finance Corporation" },
  { symbol: "RECLTD", name: "REC Limited" },
  { symbol: "NBCC", name: "NBCC India" },
  { symbol: "CONCOR", name: "Container Corporation" },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical" },
  { symbol: "DRREDDY", name: "Dr Reddys Laboratories" },
  { symbol: "CIPLA", name: "Cipla" },
  { symbol: "DIVISLAB", name: "Divi's Laboratories" },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals" },
  { symbol: "MAXHEALTH", name: "Max Healthcare" },
  { symbol: "LUPIN", name: "Lupin" },
  { symbol: "AUROPHARMA", name: "Aurobindo Pharma" },
  { symbol: "MANKIND", name: "Mankind Pharma" },
  { symbol: "ZYDUSLIFE", name: "Zydus Lifesciences" },
  { symbol: "TATAMOTORS", name: "Tata Motors" },
  { symbol: "M&M", name: "Mahindra & Mahindra" },
  { symbol: "MARUTI", name: "Maruti Suzuki" },
  { symbol: "EICHERMOT", name: "Eicher Motors" },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp" },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto" },
  { symbol: "TVSMOTOR", name: "TVS Motor" },
  { symbol: "ASHOKLEY", name: "Ashok Leyland" },
  { symbol: "BOSCHLTD", name: "Bosch" },
  { symbol: "TIINDIA", name: "Tube Investments" },
  { symbol: "BAJFINANCE", name: "Bajaj Finance" },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv" },
  { symbol: "JIOFIN", name: "Jio Financial Services" },
  { symbol: "HDFCLIFE", name: "HDFC Life" },
  { symbol: "SBILIFE", name: "SBI Life" },
  { symbol: "CHOLAFIN", name: "Cholamandalam Finance" },
  { symbol: "SHRIRAMFIN", name: "Shriram Finance" },
  { symbol: "MUTHOOTFIN", name: "Muthoot Finance" },
  { symbol: "MANAPPURAM", name: "Manappuram Finance" },
  { symbol: "ABCAPITAL", name: "Aditya Birla Capital" },
  { symbol: "LTF", name: "L&T Finance" },
  { symbol: "SUZLON", name: "Suzlon Energy" },
  { symbol: "ETERNAL", name: "Eternal" },
  { symbol: "PAYTM", name: "One 97 Communications" },
  { symbol: "YESBANK", name: "YES Bank" },
];

export interface CuratedIndex {
  symbol: string;
  name: string;
  providerAliases: string[];
}

export const CURATED_INDICES: CuratedIndex[] = [
  { symbol: "NIFTY", name: "NIFTY 50", providerAliases: ["NIFTY 50", "NIFTY50"] },
  { symbol: "SENSEX", name: "BSE SENSEX", providerAliases: ["SENSEX", "BSE SENSEX"] },
  { symbol: "BANKNIFTY", name: "NIFTY BANK", providerAliases: ["NIFTY BANK", "NIFTYBANK"] },
  { symbol: "NIFTYNXT50", name: "NIFTY NEXT 50", providerAliases: ["NIFTY NEXT 50", "NIFTYNEXT50"] },
  { symbol: "NIFTY100", name: "NIFTY 100", providerAliases: ["NIFTY 100", "NIFTY100"] },
  { symbol: "NIFTY200", name: "NIFTY 200", providerAliases: ["NIFTY 200", "NIFTY200"] },
  { symbol: "NIFTY500", name: "NIFTY 500", providerAliases: ["NIFTY 500", "NIFTY500"] },
  { symbol: "NIFTYMID50", name: "NIFTY MIDCAP 50", providerAliases: ["NIFTY MIDCAP 50", "NIFTY_MIDCAP_50", "NIFTYMID50"] },
  { symbol: "NIFTYMIDCAP100", name: "NIFTY MIDCAP 100", providerAliases: ["NIFTY MIDCAP 100", "NIFTYMIDCAP100"] },
  { symbol: "NIFTYMIDCAP150", name: "NIFTY MIDCAP 150", providerAliases: ["NIFTY MIDCAP 150", "NIFTYMIDCAP150"] },
  { symbol: "NIFTYSMLCAP50", name: "NIFTY SMALLCAP 50", providerAliases: ["NIFTY SMALLCAP 50", "NIFTYSMLCAP50"] },
  { symbol: "NIFTYSMLCAP100", name: "NIFTY SMALLCAP 100", providerAliases: ["NIFTY SMALLCAP 100", "NIFTYSMLCAP100"] },
  { symbol: "NIFTYSMLCAP250", name: "NIFTY SMALLCAP 250", providerAliases: ["NIFTY SMALLCAP 250", "NIFTYSMLCAP250"] },
  { symbol: "FINNIFTY", name: "NIFTY FINANCIAL SERVICES", providerAliases: ["NIFTY FINANCIAL SERVICES", "NIFTY FIN SERVICE", "FINNIFTY"] },
  { symbol: "NIFTYIT", name: "NIFTY IT", providerAliases: ["NIFTY IT", "NIFTYIT"] },
  { symbol: "NIFTYAUTO", name: "NIFTY AUTO", providerAliases: ["NIFTY AUTO", "NIFTYAUTO"] },
  { symbol: "NIFTYPHARMA", name: "NIFTY PHARMA", providerAliases: ["NIFTY PHARMA", "NIFTYPHARMA"] },
  { symbol: "NIFTYFMCG", name: "NIFTY FMCG", providerAliases: ["NIFTY FMCG", "NIFTYFMCG"] },
  { symbol: "NIFTYMETAL", name: "NIFTY METAL", providerAliases: ["NIFTY METAL", "NIFTYMETAL"] },
  { symbol: "NIFTYREALTY", name: "NIFTY REALTY", providerAliases: ["NIFTY REALTY", "NIFTYREALTY"] },
  { symbol: "NIFTYENERGY", name: "NIFTY ENERGY", providerAliases: ["NIFTY ENERGY", "NIFTYENERGY"] },
  { symbol: "NIFTYINFRA", name: "NIFTY INFRASTRUCTURE", providerAliases: ["NIFTY INFRASTRUCTURE", "NIFTY INFRA", "NIFTYINFRA"] },
  { symbol: "NIFTYMEDIA", name: "NIFTY MEDIA", providerAliases: ["NIFTY MEDIA", "NIFTYMEDIA"] },
  { symbol: "NIFTYPSUBANK", name: "NIFTY PSU BANK", providerAliases: ["NIFTY PSU BANK", "NIFTYPSUBANK"] },
  { symbol: "NIFTYPVTBANK", name: "NIFTY PRIVATE BANK", providerAliases: ["NIFTY PRIVATE BANK", "NIFTY PVT BANK", "NIFTYPVTBANK"] },
];

const normalize = (value: string | null | undefined) => (value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
const STOCK_SYMBOLS = new Map(CURATED_STOCKS.map((stock) => [normalize(stock.symbol), stock]));
const STOCK_ALIAS_TO_SYMBOL = new Map([["TMPV", "TATAMOTORS"]]);
const INDEX_ALIASES = new Map<string, CuratedIndex>();

for (const index of CURATED_INDICES) {
  for (const alias of [index.symbol, index.name, ...index.providerAliases]) {
    INDEX_ALIASES.set(normalize(alias), index);
  }
}

export function curatedStockForInstrument(...values: Array<string | null | undefined>): CuratedStock | undefined {
  for (const value of values) {
    const key = normalize(value);
    const stock = STOCK_SYMBOLS.get(STOCK_ALIAS_TO_SYMBOL.get(key) ?? key);
    if (stock) return stock;
  }
  return undefined;
}

export function curatedIndexForSymbol(value: string | null | undefined): CuratedIndex | undefined {
  return INDEX_ALIASES.get(normalize(value));
}

export function curatedIndexForInstrument(...values: Array<string | null | undefined>): CuratedIndex | undefined {
  for (const value of values) {
    const index = curatedIndexForSymbol(value);
    if (index) return index;
  }
  return undefined;
}

export function canonicalCuratedStockSymbol(value: string): string {
  const key = normalize(value);
  return key === "TATAMOTORS" ? "TMPV" : value;
}

export function rankRowsByVolume<T extends { symbol: string; chartSymbol?: string }>(
  rows: T[],
  quotes: Record<string, { volume?: number | null } | undefined>,
): T[] {
  return rows
    .map((row, index) => ({
      row,
      index,
      volume: quotes[row.chartSymbol ?? row.symbol]?.volume,
    }))
    .sort((a, b) => {
      const aHasVolume = Number.isFinite(a.volume) && (a.volume ?? -1) >= 0;
      const bHasVolume = Number.isFinite(b.volume) && (b.volume ?? -1) >= 0;
      if (aHasVolume && bHasVolume) return (b.volume ?? 0) - (a.volume ?? 0) || a.index - b.index;
      if (aHasVolume) return -1;
      if (bHasVolume) return 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}
