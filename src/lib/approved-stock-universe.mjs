export const APPROVED_STOCK_UNIVERSE = [
  {
    category: "Banking & Financials",
    symbols: [
      "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "INDUSINDBK",
      "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "FEDERALBNK", "IDFCFIRSTB",
      "BANDHANBNK", "RBLBANK", "YESBANK", "AUBANK", "BANKINDIA", "MAHABANK",
      "INDIANB", "CUB",
    ],
  },
  {
    category: "IT",
    symbols: [
      "TCS", "INFY", "HCLTECH", "WIPRO", "TECHM", "LTIM", "PERSISTENT", "COFORGE",
      "MPHASIS", "LTTS", "OFSS", "KPITTECH", "TATAELXSI", "CYIENT", "SONATSOFTW",
      "ZENSARTECH", "BIRLASOFT", "HAPPSTMNDS", "INTELLECT", "ROUTE",
    ],
  },
  {
    category: "Automobile",
    symbols: [
      "MARUTI", "TATAMOTORS", "M&M", "HEROMOTOCO", "BAJAJ-AUTO", "EICHERMOT",
      "TVSMOTOR", "ASHOKLEY", "ESCORTS", "FORCEMOT", "BOSCH", "MOTHERSON",
      "BALKRISIND", "EXIDEIND", "ARE&M", "TIINDIA", "SONACOMS", "BHARATFORG",
      "UNOMINDA", "APOLLOTYRE", "TVSSCS", "SONA",
    ],
  },
  {
    category: "FMCG & Consumer",
    symbols: [
      "HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "DABUR", "GODREJCP", "MARICO",
      "COLPAL", "TATACONSUM", "VBL", "UNITEDSPIR", "TRENT", "JUBLFOOD", "DMART",
      "NYKAA", "PAGEIND", "EMAMILTD", "RADICO", "KHAITAN", "TATACOFFEE",
    ],
  },
  {
    category: "Metals & Mining",
    symbols: [
      "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "SAIL", "JINDALSTEL", "NMDC",
      "NATIONALUM", "HINDCOPPER", "WELCORP", "RATNAMANI", "APLAPOLLO", "JSL",
      "MOIL", "GRAPHITE", "HINDZINC", "GPIL", "KALYANKJIL", "JINDALSAW", "JIOFIN",
    ],
  },
  {
    category: "Energy & Utilities",
    symbols: [
      "RELIANCE", "ONGC", "BPCL", "IOC", "GAIL", "PETRONET", "ADANIGREEN",
      "TATAPOWER", "NTPC", "POWERGRID", "JSWENERGY", "NHPC", "SJVN", "OIL", "IGL",
      "MGL", "GUJGAS", "ATGL", "TORNTPOWER", "CESC",
    ],
  },
  {
    category: "Pharma & Healthcare",
    symbols: [
      "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "LUPIN", "AUROPHARMA", "BIOCON",
      "TORNTPHARM", "ALKEM", "MANKIND", "LAURUSLABS", "GLENMARK", "ZYDUSLIFE",
      "APOLLOHOSP", "MAXHEALTH", "SYNGENE", "METROPOLIS", "LALPATHLAB", "PFIZER",
    ],
  },
  {
    category: "Infrastructure & Capital Goods",
    symbols: [
      "LT", "ADANIPORTS", "ADANIENT", "SIEMENS", "ABB", "BEL", "HAL", "BHEL",
      "RVNL", "IRCON", "NBCC", "NCC", "KEC", "KALPATPOWR", "CUMMINSIND", "POLYCAB",
      "KEI", "HAVELLS", "VOLTAS", "CGPOWER",
    ],
  },
  {
    category: "Chemicals & Industrials",
    symbols: [
      "SRF", "PIIND", "UPL", "DEEPAKNTR", "AARTIIND", "ATUL", "NAVINFLUOR",
      "CLEAN", "TATACHEM", "GNFC", "CHAMBLFERT", "COROMANDEL", "PNCINFRA",
      "SUPREMEIND", "ASTRAL", "PIDILITIND", "BERGERPAINT", "ASIANPAINT", "KANSAINER",
    ],
  },
  {
    category: "Logistics & Financial Services",
    symbols: [
      "CONCOR", "DELHIVERY", "BLUEDART", "GESHIP", "SCI", "ALLCARGO", "VRLLOG",
      "MAHLOG", "TCI", "IEX", "BSE", "CDSL", "MCX", "ANGELONE", "CAMS", "KFINTECH",
      "PFC", "RECLTD", "CHOLAFIN", "SHRIRAMFIN",
    ],
  },
];

export const LEGACY_STOCK_SYMBOL_ALIASES = {
  LTIM: "LTM",
  TATAMOTORS: "TMPV",
  BIRLASOFT: "BSOFT",
  BOSCH: "BOSCHLTD",
  UNITEDSPIR: "UNITDSPR",
  KHAITAN: "KHAITANLTD",
  KALPATPOWR: "KALPATARU",
  BERGERPAINT: "BERGEPAINT",
  TATACOFFEE: "TATACONSUM",
};

export const UNRESOLVED_APPROVED_STOCK_SYMBOLS = ["GUJGAS"];

export const normalizeApprovedStockKey = (value) =>
  String(value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();

const unresolvedStockKeys = new Set(UNRESOLVED_APPROVED_STOCK_SYMBOLS.map(normalizeApprovedStockKey));
const canonicalByKey = new Map(
  [...new Set(APPROVED_STOCK_UNIVERSE.flatMap(({ symbols }) =>
    symbols.map((symbol) => LEGACY_STOCK_SYMBOL_ALIASES[symbol] ?? symbol),
  ))]
    .filter((symbol) => !unresolvedStockKeys.has(normalizeApprovedStockKey(symbol)))
    .map((symbol) => [normalizeApprovedStockKey(symbol), symbol]),
);
const aliasesByKey = new Map(
  Object.entries(LEGACY_STOCK_SYMBOL_ALIASES).map(([legacy, current]) => [
    normalizeApprovedStockKey(legacy),
    current,
  ]),
);
const stockKeysByLength = [...canonicalByKey.keys(), ...aliasesByKey.keys()]
  .sort((left, right) => right.length - left.length);

function isSymbolBoundary(value, key) {
  let consumed = 0;
  let position = 0;
  while (position < value.length && consumed < key.length) {
    if (/[A-Z0-9]/i.test(value[position])) consumed += 1;
    position += 1;
  }
  return consumed === key.length &&
    (position === value.length || /[\s_-]/.test(value[position]) || /\d/.test(value[position]));
}

export function resolveApprovedStockSymbol(value) {
  const source = String(value ?? "").trim().toUpperCase();
  const key = normalizeApprovedStockKey(source);
  const exact = aliasesByKey.get(key) ?? canonicalByKey.get(key);
  if (exact) return exact;

  for (const candidateKey of stockKeysByLength) {
    if (!key.startsWith(candidateKey) || !isSymbolBoundary(source, candidateKey)) continue;
    return canonicalByKey.get(candidateKey) ?? aliasesByKey.get(candidateKey);
  }
  return undefined;
}
