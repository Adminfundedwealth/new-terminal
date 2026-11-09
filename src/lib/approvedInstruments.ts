/**
 * APPROVED 200 NSE STOCK UNIVERSE
 * 
 * This is the canonical list of approved NSE stocks for the FundedWealth Terminal.
 * All Stocks, Futures, and Option Chain screens must use only these approved instruments.
 * 
 * Last Updated: 2026-11-09
 * Source: NSE F&O segment + Manual verification
 */

// ── NSE Symbol to Dhan Trading Symbol Mapping ──
// Known Dhan-specific mappings that differ from NSE symbols
export const NSE_TO_DHAN_SYMBOL_MAP: Record<string, string> = {
  "TATAMOTORS": "TMPV",          // Tata Motors Parent + Voting
  "LTIM": "LTM",                 // LTIMindtree
  "BIRLASOFT": "BSOFT",          // Birlasoft
  "BOSCH": "BOSCHLTD",           // Bosch Limited
  "UNITEDSPIR": "UNITDSPR",      // United Spirits
  "KHAITAN": "KHAITANLTD",       // Khaitan Electricals
  "KALPATPOWR": "KALPATARU",     // Kalpataru Power
  "BERGERPAINT": "BERGEPAINT",   // Berger Paints
  "M&M": "M&M",                  // Mahindra & Mahindra (stays same)
  "BAJAJ-AUTO": "BAJAJ-AUTO",    // Bajaj Auto (stays same)
  "L&TFH": "LTF",                // L&T Finance Holdings
  "MCDOWELL-N": "MCDOWELL-N",    // McDowell-N (stays same)
};

// ── TradingView Symbol Mapping ──
// Maps NSE symbols to TradingView exchange-qualified symbols
export const NSE_TO_TRADINGVIEW_MAP: Record<string, string> = {
  "HDFCBANK": "NSE:HDFCBANK",
  "ICICIBANK": "NSE:ICICIBANK",
  "SBIN": "NSE:SBIN",
  "RELIANCE": "NSE:RELIANCE",
  "TCS": "NSE:TCS",
  "INFY": "NSE:INFY",
  // Add more as needed - default pattern is NSE:SYMBOL
};

/**
 * Get the Dhan trading symbol for a given NSE symbol
 */
export function getDhanSymbol(nseSymbol: string): string {
  return NSE_TO_DHAN_SYMBOL_MAP[nseSymbol] || nseSymbol;
}

/**
 * Get the TradingView symbol for a given NSE symbol
 */
export function getTradingViewSymbol(nseSymbol: string): string {
  return NSE_TO_TRADINGVIEW_MAP[nseSymbol] || `NSE:${nseSymbol}`;
}

// ── APPROVED 200 NSE STOCKS ──

export interface ApprovedStock {
  symbol: string;              // NSE symbol
  name: string;                // Company name
  sector: string;              // Sector classification
  dhanSymbol: string;          // Dhan trading symbol (may differ)
  tradingViewSymbol: string;   // TradingView chart symbol
  isFnO: boolean;              // Has F&O derivatives available
  lotSize?: number;            // F&O lot size (if applicable)
}

/**
 * Banking & Financial Services - 26 stocks
 */
export const BANKING_FINANCIAL: ApprovedStock[] = [
  { symbol: "HDFCBANK", name: "HDFC Bank Ltd", sector: "Banking & Financial", dhanSymbol: "HDFCBANK", tradingViewSymbol: "NSE:HDFCBANK", isFnO: true, lotSize: 550 },
  { symbol: "ICICIBANK", name: "ICICI Bank Ltd", sector: "Banking & Financial", dhanSymbol: "ICICIBANK", tradingViewSymbol: "NSE:ICICIBANK", isFnO: true, lotSize: 1375 },
  { symbol: "SBIN", name: "State Bank of India", sector: "Banking & Financial", dhanSymbol: "SBIN", tradingViewSymbol: "NSE:SBIN", isFnO: true, lotSize: 1500 },
  { symbol: "AXISBANK", name: "Axis Bank Ltd", sector: "Banking & Financial", dhanSymbol: "AXISBANK", tradingViewSymbol: "NSE:AXISBANK", isFnO: true, lotSize: 1200 },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", sector: "Banking & Financial", dhanSymbol: "KOTAKBANK", tradingViewSymbol: "NSE:KOTAKBANK", isFnO: true, lotSize: 400 },
  { symbol: "INDUSINDBK", name: "IndusInd Bank Ltd", sector: "Banking & Financial", dhanSymbol: "INDUSINDBK", tradingViewSymbol: "NSE:INDUSINDBK", isFnO: true, lotSize: 900 },
  { symbol: "BANKBARODA", name: "Bank of Baroda", sector: "Banking & Financial", dhanSymbol: "BANKBARODA", tradingViewSymbol: "NSE:BANKBARODA", isFnO: true, lotSize: 5200 },
  { symbol: "PNB", name: "Punjab National Bank", sector: "Banking & Financial", dhanSymbol: "PNB", tradingViewSymbol: "NSE:PNB", isFnO: true, lotSize: 10000 },
  { symbol: "CANBK", name: "Canara Bank", sector: "Banking & Financial", dhanSymbol: "CANBK", tradingViewSymbol: "NSE:CANBK", isFnO: true, lotSize: 9000 },
  { symbol: "UNIONBANK", name: "Union Bank of India", sector: "Banking & Financial", dhanSymbol: "UNIONBANK", tradingViewSymbol: "NSE:UNIONBANK", isFnO: true, lotSize: 8250 },
  { symbol: "FEDERALBNK", name: "Federal Bank Ltd", sector: "Banking & Financial", dhanSymbol: "FEDERALBNK", tradingViewSymbol: "NSE:FEDERALBNK", isFnO: true, lotSize: 5500 },
  { symbol: "IDFCFIRSTB", name: "IDFC First Bank Ltd", sector: "Banking & Financial", dhanSymbol: "IDFCFIRSTB", tradingViewSymbol: "NSE:IDFCFIRSTB", isFnO: true, lotSize: 14000 },
  { symbol: "AUBANK", name: "AU Small Finance Bank", sector: "Banking & Financial", dhanSymbol: "AUBANK", tradingViewSymbol: "NSE:AUBANK", isFnO: true, lotSize: 1250 },
  { symbol: "BAJFINANCE", name: "Bajaj Finance Ltd", sector: "Banking & Financial", dhanSymbol: "BAJFINANCE", tradingViewSymbol: "NSE:BAJFINANCE", isFnO: true, lotSize: 125 },
  { symbol: "BAJAJFINSV", name: "Bajaj Finserv Ltd", sector: "Banking & Financial", dhanSymbol: "BAJAJFINSV", tradingViewSymbol: "NSE:BAJAJFINSV", isFnO: true, lotSize: 1250 },
  { symbol: "SHRIRAMFIN", name: "Shriram Finance Ltd", sector: "Banking & Financial", dhanSymbol: "SHRIRAMFIN", tradingViewSymbol: "NSE:SHRIRAMFIN", isFnO: true, lotSize: 350 },
  { symbol: "CHOLAFIN", name: "Cholamandalam Investment", sector: "Banking & Financial", dhanSymbol: "CHOLAFIN", tradingViewSymbol: "NSE:CHOLAFIN", isFnO: true, lotSize: 650 },
  { symbol: "MUTHOOTFIN", name: "Muthoot Finance Ltd", sector: "Banking & Financial", dhanSymbol: "MUTHOOTFIN", tradingViewSymbol: "NSE:MUTHOOTFIN", isFnO: true, lotSize: 400 },
  { symbol: "MANAPPURAM", name: "Manappuram Finance Ltd", sector: "Banking & Financial", dhanSymbol: "MANAPPURAM", tradingViewSymbol: "NSE:MANAPPURAM", isFnO: true, lotSize: 5000 },
  { symbol: "LTF", name: "L&T Finance Holdings", sector: "Banking & Financial", dhanSymbol: "LTF", tradingViewSymbol: "NSE:LTF", isFnO: true, lotSize: 8500 },
  { symbol: "HDFCLIFE", name: "HDFC Life Insurance", sector: "Banking & Financial", dhanSymbol: "HDFCLIFE", tradingViewSymbol: "NSE:HDFCLIFE", isFnO: true, lotSize: 1100 },
  { symbol: "SBILIFE", name: "SBI Life Insurance", sector: "Banking & Financial", dhanSymbol: "SBILIFE", tradingViewSymbol: "NSE:SBILIFE", isFnO: true, lotSize: 500 },
  { symbol: "ICICIPRULI", name: "ICICI Prudential Life", sector: "Banking & Financial", dhanSymbol: "ICICIPRULI", tradingViewSymbol: "NSE:ICICIPRULI", isFnO: true, lotSize: 1400 },
  { symbol: "MAXHEALTH", name: "Max Healthcare Institute", sector: "Banking & Financial", dhanSymbol: "MAXHEALTH", tradingViewSymbol: "NSE:MAXHEALTH", isFnO: true, lotSize: 1000 },
  { symbol: "RBLBANK", name: "RBL Bank Ltd", sector: "Banking & Financial", dhanSymbol: "RBLBANK", tradingViewSymbol: "NSE:RBLBANK", isFnO: true, lotSize: 4000 },
  { symbol: "BANDHANBNK", name: "Bandhan Bank Ltd", sector: "Banking & Financial", dhanSymbol: "BANDHANBNK", tradingViewSymbol: "NSE:BANDHANBNK", isFnO: true, lotSize: 3750 },
];

/**
 * IT & Technology - 20 stocks
 */
export const IT_TECHNOLOGY: ApprovedStock[] = [
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT & Technology", dhanSymbol: "TCS", tradingViewSymbol: "NSE:TCS", isFnO: true, lotSize: 125 },
  { symbol: "INFY", name: "Infosys Ltd", sector: "IT & Technology", dhanSymbol: "INFY", tradingViewSymbol: "NSE:INFY", isFnO: true, lotSize: 300 },
  { symbol: "WIPRO", name: "Wipro Ltd", sector: "IT & Technology", dhanSymbol: "WIPRO", tradingViewSymbol: "NSE:WIPRO", isFnO: true, lotSize: 1200 },
  { symbol: "HCLTECH", name: "HCL Technologies Ltd", sector: "IT & Technology", dhanSymbol: "HCLTECH", tradingViewSymbol: "NSE:HCLTECH", isFnO: true, lotSize: 350 },
  { symbol: "TECHM", name: "Tech Mahindra Ltd", sector: "IT & Technology", dhanSymbol: "TECHM", tradingViewSymbol: "NSE:TECHM", isFnO: true, lotSize: 550 },
  { symbol: "LTIM", name: "LTIMindtree Ltd", sector: "IT & Technology", dhanSymbol: "LTM", tradingViewSymbol: "NSE:LTIM", isFnO: true, lotSize: 150 },
  { symbol: "PERSISTENT", name: "Persistent Systems", sector: "IT & Technology", dhanSymbol: "PERSISTENT", tradingViewSymbol: "NSE:PERSISTENT", isFnO: true, lotSize: 125 },
  { symbol: "COFORGE", name: "Coforge Ltd", sector: "IT & Technology", dhanSymbol: "COFORGE", tradingViewSymbol: "NSE:COFORGE", isFnO: true, lotSize: 100 },
  { symbol: "MPHASIS", name: "Mphasis Ltd", sector: "IT & Technology", dhanSymbol: "MPHASIS", tradingViewSymbol: "NSE:MPHASIS", isFnO: true, lotSize: 250 },
  { symbol: "OFSS", name: "Oracle Financial Services", sector: "IT & Technology", dhanSymbol: "OFSS", tradingViewSymbol: "NSE:OFSS", isFnO: true, lotSize: 100 },
  { symbol: "LTTS", name: "L&T Technology Services", sector: "IT & Technology", dhanSymbol: "LTTS", tradingViewSymbol: "NSE:LTTS", isFnO: true, lotSize: 150 },
  { symbol: "KPITTECH", name: "KPIT Technologies", sector: "IT & Technology", dhanSymbol: "KPITTECH", tradingViewSymbol: "NSE:KPITTECH", isFnO: true, lotSize: 550 },
  { symbol: "TATAELXSI", name: "Tata Elxsi Ltd", sector: "IT & Technology", dhanSymbol: "TATAELXSI", tradingViewSymbol: "NSE:TATAELXSI", isFnO: true, lotSize: 100 },
  { symbol: "CYIENT", name: "Cyient Ltd", sector: "IT & Technology", dhanSymbol: "CYIENT", tradingViewSymbol: "NSE:CYIENT", isFnO: true, lotSize: 500 },
  { symbol: "ZENSARTECH", name: "Zensar Technologies", sector: "IT & Technology", dhanSymbol: "ZENSARTECH", tradingViewSymbol: "NSE:ZENSARTECH", isFnO: true, lotSize: 1250 },
  { symbol: "HAPPSTMNDS", name: "Happiest Minds Tech", sector: "IT & Technology", dhanSymbol: "HAPPSTMNDS", tradingViewSymbol: "NSE:HAPPSTMNDS", isFnO: true, lotSize: 1000 },
  { symbol: "SONATSOFTW", name: "Sonata Software Ltd", sector: "IT & Technology", dhanSymbol: "SONATSOFTW", tradingViewSymbol: "NSE:SONATSOFTW", isFnO: true, lotSize: 1500 },
  { symbol: "SASKEN", name: "Sasken Technologies", sector: "IT & Technology", dhanSymbol: "SASKEN", tradingViewSymbol: "NSE:SASKEN", isFnO: true, lotSize: 875 },
  { symbol: "INTELLECT", name: "Intellect Design Arena", sector: "IT & Technology", dhanSymbol: "INTELLECT", tradingViewSymbol: "NSE:INTELLECT", isFnO: true, lotSize: 1000 },
  { symbol: "BIRLASOFT", name: "Birlasoft Ltd", sector: "IT & Technology", dhanSymbol: "BSOFT", tradingViewSymbol: "NSE:BIRLASOFT", isFnO: true, lotSize: 2500 },
];

/**
 * Automobile & Auto Components - 20 stocks
 */
export const AUTO_AUTO_COMPONENTS: ApprovedStock[] = [
  { symbol: "TATAMOTORS", name: "Tata Motors Ltd", sector: "Automobile & Auto Components", dhanSymbol: "TMPV", tradingViewSymbol: "NSE:TATAMOTORS", isFnO: true, lotSize: 1500 },
  { symbol: "M&M", name: "Mahindra & Mahindra", sector: "Automobile & Auto Components", dhanSymbol: "M&M", tradingViewSymbol: "NSE:M&M", isFnO: true, lotSize: 300 },
  { symbol: "MARUTI", name: "Maruti Suzuki India", sector: "Automobile & Auto Components", dhanSymbol: "MARUTI", tradingViewSymbol: "NSE:MARUTI", isFnO: true, lotSize: 50 },
  { symbol: "HEROMOTOCO", name: "Hero MotoCorp Ltd", sector: "Automobile & Auto Components", dhanSymbol: "HEROMOTOCO", tradingViewSymbol: "NSE:HEROMOTOCO", isFnO: true, lotSize: 150 },
  { symbol: "EICHERMOT", name: "Eicher Motors Ltd", sector: "Automobile & Auto Components", dhanSymbol: "EICHERMOT", tradingViewSymbol: "NSE:EICHERMOT", isFnO: true, lotSize: 175 },
  { symbol: "TVSMOTOR", name: "TVS Motor Company", sector: "Automobile & Auto Components", dhanSymbol: "TVSMOTOR", tradingViewSymbol: "NSE:TVSMOTOR", isFnO: true, lotSize: 300 },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto Ltd", sector: "Automobile & Auto Components", dhanSymbol: "BAJAJ-AUTO", tradingViewSymbol: "NSE:BAJAJ-AUTO", isFnO: true, lotSize: 100 },
  { symbol: "ASHOKLEY", name: "Ashok Leyland Ltd", sector: "Automobile & Auto Components", dhanSymbol: "ASHOKLEY", tradingViewSymbol: "NSE:ASHOKLEY", isFnO: true, lotSize: 5000 },
  { symbol: "MOTHERSON", name: "Samvardhana Motherson", sector: "Automobile & Auto Components", dhanSymbol: "MOTHERSON", tradingViewSymbol: "NSE:MOTHERSON", isFnO: true, lotSize: 6500 },
  { symbol: "BOSCHLTD", name: "Bosch Ltd", sector: "Automobile & Auto Components", dhanSymbol: "BOSCHLTD", tradingViewSymbol: "NSE:BOSCHLTD", isFnO: true, lotSize: 25 },
  { symbol: "BHARATFORG", name: "Bharat Forge Ltd", sector: "Automobile & Auto Components", dhanSymbol: "BHARATFORG", tradingViewSymbol: "NSE:BHARATFORG", isFnO: true, lotSize: 750 },
  { symbol: "SONACOMS", name: "Sona BLW Precision", sector: "Automobile & Auto Components", dhanSymbol: "SONACOMS", tradingViewSymbol: "NSE:SONACOMS", isFnO: true, lotSize: 1250 },
  { symbol: "UNOMINDA", name: "Uno Minda Ltd", sector: "Automobile & Auto Components", dhanSymbol: "UNOMINDA", tradingViewSymbol: "NSE:UNOMINDA", isFnO: true, lotSize: 1250 },
  { symbol: "EXIDEIND", name: "Exide Industries Ltd", sector: "Automobile & Auto Components", dhanSymbol: "EXIDEIND", tradingViewSymbol: "NSE:EXIDEIND", isFnO: true, lotSize: 2000 },
  { symbol: "AMARAJABAT", name: "Amara Raja Energy", sector: "Automobile & Auto Components", dhanSymbol: "AMARAJABAT", tradingViewSymbol: "NSE:AMARAJABAT", isFnO: true, lotSize: 1750 },
  { symbol: "TIINDIA", name: "Tube Investments of India", sector: "Automobile & Auto Components", dhanSymbol: "TIINDIA", tradingViewSymbol: "NSE:TIINDIA", isFnO: true, lotSize: 250 },
  { symbol: "MRF", name: "MRF Ltd", sector: "Automobile & Auto Components", dhanSymbol: "MRF", tradingViewSymbol: "NSE:MRF", isFnO: true, lotSize: 6 },
  { symbol: "BALKRISIND", name: "Balkrishna Industries", sector: "Automobile & Auto Components", dhanSymbol: "BALKRISIND", tradingViewSymbol: "NSE:BALKRISIND", isFnO: true, lotSize: 250 },
  { symbol: "APOLLOTYRE", name: "Apollo Tyres Ltd", sector: "Automobile & Auto Components", dhanSymbol: "APOLLOTYRE", tradingViewSymbol: "NSE:APOLLOTYRE", isFnO: true, lotSize: 1750 },
  { symbol: "ENDURANCE", name: "Endurance Technologies", sector: "Automobile & Auto Components", dhanSymbol: "ENDURANCE", tradingViewSymbol: "NSE:ENDURANCE", isFnO: true, lotSize: 500 },
];

/**
 * FMCG, Consumer & Retail - 20 stocks
 */
export const FMCG_CONSUMER_RETAIL: ApprovedStock[] = [
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "FMCG, Consumer & Retail", dhanSymbol: "HINDUNILVR", tradingViewSymbol: "NSE:HINDUNILVR", isFnO: true, lotSize: 300 },
  { symbol: "ITC", name: "ITC Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "ITC", tradingViewSymbol: "NSE:ITC", isFnO: true, lotSize: 1600 },
  { symbol: "NESTLEIND", name: "Nestle India Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "NESTLEIND", tradingViewSymbol: "NSE:NESTLEIND", isFnO: true, lotSize: 250 },
  { symbol: "BRITANNIA", name: "Britannia Industries", sector: "FMCG, Consumer & Retail", dhanSymbol: "BRITANNIA", tradingViewSymbol: "NSE:BRITANNIA", isFnO: true, lotSize: 150 },
  { symbol: "DABUR", name: "Dabur India Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "DABUR", tradingViewSymbol: "NSE:DABUR", isFnO: true, lotSize: 1200 },
  { symbol: "GODREJCP", name: "Godrej Consumer Products", sector: "FMCG, Consumer & Retail", dhanSymbol: "GODREJCP", tradingViewSymbol: "NSE:GODREJCP", isFnO: true, lotSize: 600 },
  { symbol: "MARICO", name: "Marico Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "MARICO", tradingViewSymbol: "NSE:MARICO", isFnO: true, lotSize: 1100 },
  { symbol: "COLPAL", name: "Colgate-Palmolive India", sector: "FMCG, Consumer & Retail", dhanSymbol: "COLPAL", tradingViewSymbol: "NSE:COLPAL", isFnO: true, lotSize: 225 },
  { symbol: "TATACONSUM", name: "Tata Consumer Products", sector: "FMCG, Consumer & Retail", dhanSymbol: "TATACONSUM", tradingViewSymbol: "NSE:TATACONSUM", isFnO: true, lotSize: 700 },
  { symbol: "TRENT", name: "Trent Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "TRENT", tradingViewSymbol: "NSE:TRENT", isFnO: true, lotSize: 125 },
  { symbol: "TITAN", name: "Titan Company Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "TITAN", tradingViewSymbol: "NSE:TITAN", isFnO: true, lotSize: 250 },
  { symbol: "JUBLFOOD", name: "Jubilant Foodworks", sector: "FMCG, Consumer & Retail", dhanSymbol: "JUBLFOOD", tradingViewSymbol: "NSE:JUBLFOOD", isFnO: true, lotSize: 1500 },
  { symbol: "DMART", name: "Avenue Supermarts", sector: "FMCG, Consumer & Retail", dhanSymbol: "DMART", tradingViewSymbol: "NSE:DMART", isFnO: true, lotSize: 175 },
  { symbol: "NYKAA", name: "FSN E-Commerce Ventures", sector: "FMCG, Consumer & Retail", dhanSymbol: "NYKAA", tradingViewSymbol: "NSE:NYKAA", isFnO: true, lotSize: 4000 },
  { symbol: "ETERNAL", name: "Eternal Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "ETERNAL", tradingViewSymbol: "NSE:ETERNAL", isFnO: true, lotSize: 250 },
  { symbol: "PAGEIND", name: "Page Industries Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "PAGEIND", tradingViewSymbol: "NSE:PAGEIND", isFnO: true, lotSize: 20 },
  { symbol: "VBL", name: "Varun Beverages Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "VBL", tradingViewSymbol: "NSE:VBL", isFnO: true, lotSize: 1250 },
  { symbol: "UNITDSPR", name: "United Spirits Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "UNITDSPR", tradingViewSymbol: "NSE:UNITDSPR", isFnO: true, lotSize: 600 },
  { symbol: "PATANJALI", name: "Patanjali Foods Ltd", sector: "FMCG, Consumer & Retail", dhanSymbol: "PATANJALI", tradingViewSymbol: "NSE:PATANJALI", isFnO: true, lotSize: 500 },
  { symbol: "KALYANKJIL", name: "Kalyan Jewellers India", sector: "FMCG, Consumer & Retail", dhanSymbol: "KALYANKJIL", tradingViewSymbol: "NSE:KALYANKJIL", isFnO: true, lotSize: 2500 },
];

/**
 * Metals & Mining - 15 stocks
 */
export const METALS_MINING: ApprovedStock[] = [
  { symbol: "TATASTEEL", name: "Tata Steel Ltd", sector: "Metals & Mining", dhanSymbol: "TATASTEEL", tradingViewSymbol: "NSE:TATASTEEL", isFnO: true, lotSize: 6500 },
  { symbol: "JSWSTEEL", name: "JSW Steel Ltd", sector: "Metals & Mining", dhanSymbol: "JSWSTEEL", tradingViewSymbol: "NSE:JSWSTEEL", isFnO: true, lotSize: 900 },
  { symbol: "HINDALCO", name: "Hindalco Industries", sector: "Metals & Mining", dhanSymbol: "HINDALCO", tradingViewSymbol: "NSE:HINDALCO", isFnO: true, lotSize: 1200 },
  { symbol: "VEDL", name: "Vedanta Ltd", sector: "Metals & Mining", dhanSymbol: "VEDL", tradingViewSymbol: "NSE:VEDL", isFnO: true, lotSize: 2200 },
  { symbol: "COALINDIA", name: "Coal India Ltd", sector: "Metals & Mining", dhanSymbol: "COALINDIA", tradingViewSymbol: "NSE:COALINDIA", isFnO: true, lotSize: 2100 },
  { symbol: "NMDC", name: "NMDC Ltd", sector: "Metals & Mining", dhanSymbol: "NMDC", tradingViewSymbol: "NSE:NMDC", isFnO: true, lotSize: 12500 },
  { symbol: "SAIL", name: "Steel Authority of India", sector: "Metals & Mining", dhanSymbol: "SAIL", tradingViewSymbol: "NSE:SAIL", isFnO: true, lotSize: 7500 },
  { symbol: "NATIONALUM", name: "National Aluminium Co", sector: "Metals & Mining", dhanSymbol: "NATIONALUM", tradingViewSymbol: "NSE:NATIONALUM", isFnO: true, lotSize: 6250 },
  { symbol: "HINDZINC", name: "Hindustan Zinc Ltd", sector: "Metals & Mining", dhanSymbol: "HINDZINC", tradingViewSymbol: "NSE:HINDZINC", isFnO: true, lotSize: 1225 },
  { symbol: "JINDALSTEL", name: "Jindal Steel & Power", sector: "Metals & Mining", dhanSymbol: "JINDALSTEL", tradingViewSymbol: "NSE:JINDALSTEL", isFnO: true, lotSize: 875 },
  { symbol: "APLAPOLLO", name: "APL Apollo Tubes", sector: "Metals & Mining", dhanSymbol: "APLAPOLLO", tradingViewSymbol: "NSE:APLAPOLLO", isFnO: true, lotSize: 500 },
  { symbol: "JINDALSAW", name: "Jindal Saw Ltd", sector: "Metals & Mining", dhanSymbol: "JINDALSAW", tradingViewSymbol: "NSE:JINDALSAW", isFnO: true, lotSize: 1250 },
  { symbol: "WELCORP", name: "Welspun Corp Ltd", sector: "Metals & Mining", dhanSymbol: "WELCORP", tradingViewSymbol: "NSE:WELCORP", isFnO: true, lotSize: 2000 },
  { symbol: "RATNAMANI", name: "Ratnamani Metals & Tubes", sector: "Metals & Mining", dhanSymbol: "RATNAMANI", tradingViewSymbol: "NSE:RATNAMANI", isFnO: true, lotSize: 200 },
  { symbol: "MOIL", name: "MOIL Ltd", sector: "Metals & Mining", dhanSymbol: "MOIL", tradingViewSymbol: "NSE:MOIL", isFnO: true, lotSize: 3500 },
];

/**
 * Energy, Oil & Power - 15 stocks
 */
export const ENERGY_OIL_POWER: ApprovedStock[] = [
  { symbol: "ONGC", name: "Oil & Natural Gas Corp", sector: "Energy, Oil & Power", dhanSymbol: "ONGC", tradingViewSymbol: "NSE:ONGC", isFnO: true, lotSize: 3400 },
  { symbol: "BPCL", name: "Bharat Petroleum Corp", sector: "Energy, Oil & Power", dhanSymbol: "BPCL", tradingViewSymbol: "NSE:BPCL", isFnO: true, lotSize: 2100 },
  { symbol: "IOC", name: "Indian Oil Corp", sector: "Energy, Oil & Power", dhanSymbol: "IOC", tradingViewSymbol: "NSE:IOC", isFnO: true, lotSize: 6000 },
  { symbol: "HINDPETRO", name: "Hindustan Petroleum", sector: "Energy, Oil & Power", dhanSymbol: "HINDPETRO", tradingViewSymbol: "NSE:HINDPETRO", isFnO: true, lotSize: 2200 },
  { symbol: "GAIL", name: "GAIL (India) Ltd", sector: "Energy, Oil & Power", dhanSymbol: "GAIL", tradingViewSymbol: "NSE:GAIL", isFnO: true, lotSize: 3600 },
  { symbol: "PETRONET", name: "Petronet LNG Ltd", sector: "Energy, Oil & Power", dhanSymbol: "PETRONET", tradingViewSymbol: "NSE:PETRONET", isFnO: true, lotSize: 2500 },
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy, Oil & Power", dhanSymbol: "RELIANCE", tradingViewSymbol: "NSE:RELIANCE", isFnO: true, lotSize: 250 },
  { symbol: "POWERGRID", name: "Power Grid Corp of India", sector: "Energy, Oil & Power", dhanSymbol: "POWERGRID", tradingViewSymbol: "NSE:POWERGRID", isFnO: true, lotSize: 2700 },
  { symbol: "NTPC", name: "NTPC Ltd", sector: "Energy, Oil & Power", dhanSymbol: "NTPC", tradingViewSymbol: "NSE:NTPC", isFnO: true, lotSize: 2250 },
  { symbol: "TATAPOWER", name: "Tata Power Company", sector: "Energy, Oil & Power", dhanSymbol: "TATAPOWER", tradingViewSymbol: "NSE:TATAPOWER", isFnO: true, lotSize: 2100 },
  { symbol: "ADANIPOWER", name: "Adani Power Ltd", sector: "Energy, Oil & Power", dhanSymbol: "ADANIPOWER", tradingViewSymbol: "NSE:ADANIPOWER", isFnO: true, lotSize: 1250 },
  { symbol: "ADANIGREEN", name: "Adani Green Energy", sector: "Energy, Oil & Power", dhanSymbol: "ADANIGREEN", tradingViewSymbol: "NSE:ADANIGREEN", isFnO: true, lotSize: 400 },
  { symbol: "NHPC", name: "NHPC Ltd", sector: "Energy, Oil & Power", dhanSymbol: "NHPC", tradingViewSymbol: "NSE:NHPC", isFnO: true, lotSize: 11000 },
  { symbol: "SJVN", name: "SJVN Ltd", sector: "Energy, Oil & Power", dhanSymbol: "SJVN", tradingViewSymbol: "NSE:SJVN", isFnO: true, lotSize: 9000 },
  { symbol: "TORNTPOWER", name: "Torrent Power Ltd", sector: "Energy, Oil & Power", dhanSymbol: "TORNTPOWER", tradingViewSymbol: "NSE:TORNTPOWER", isFnO: true, lotSize: 950 },
];

/**
 * Pharma & Healthcare - 15 stocks
 */
export const PHARMA_HEALTHCARE: ApprovedStock[] = [
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical", sector: "Pharma & Healthcare", dhanSymbol: "SUNPHARMA", tradingViewSymbol: "NSE:SUNPHARMA", isFnO: true, lotSize: 400 },
  { symbol: "DRREDDY", name: "Dr Reddys Laboratories", sector: "Pharma & Healthcare", dhanSymbol: "DRREDDY", tradingViewSymbol: "NSE:DRREDDY", isFnO: true, lotSize: 125 },
  { symbol: "CIPLA", name: "Cipla Ltd", sector: "Pharma & Healthcare", dhanSymbol: "CIPLA", tradingViewSymbol: "NSE:CIPLA", isFnO: true, lotSize: 500 },
  { symbol: "DIVISLAB", name: "Divi's Laboratories", sector: "Pharma & Healthcare", dhanSymbol: "DIVISLAB", tradingViewSymbol: "NSE:DIVISLAB", isFnO: true, lotSize: 100 },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals", sector: "Pharma & Healthcare", dhanSymbol: "APOLLOHOSP", tradingViewSymbol: "NSE:APOLLOHOSP", isFnO: true, lotSize: 100 },
  { symbol: "LUPIN", name: "Lupin Ltd", sector: "Pharma & Healthcare", dhanSymbol: "LUPIN", tradingViewSymbol: "NSE:LUPIN", isFnO: true, lotSize: 500 },
  { symbol: "AUROPHARMA", name: "Aurobindo Pharma", sector: "Pharma & Healthcare", dhanSymbol: "AUROPHARMA", tradingViewSymbol: "NSE:AUROPHARMA", isFnO: true, lotSize: 600 },
  { symbol: "BIOCON", name: "Biocon Ltd", sector: "Pharma & Healthcare", dhanSymbol: "BIOCON", tradingViewSymbol: "NSE:BIOCON", isFnO: true, lotSize: 2500 },
  { symbol: "ZYDUSLIFE", name: "Zydus Lifesciences", sector: "Pharma & Healthcare", dhanSymbol: "ZYDUSLIFE", tradingViewSymbol: "NSE:ZYDUSLIFE", isFnO: true, lotSize: 650 },
  { symbol: "LAURUSLABS", name: "Laurus Labs Ltd", sector: "Pharma & Healthcare", dhanSymbol: "LAURUSLABS", tradingViewSymbol: "NSE:LAURUSLABS", isFnO: true, lotSize: 1500 },
  { symbol: "GLENMARK", name: "Glenmark Pharmaceuticals", sector: "Pharma & Healthcare", dhanSymbol: "GLENMARK", tradingViewSymbol: "NSE:GLENMARK", isFnO: true, lotSize: 600 },
  { symbol: "MANKIND", name: "Mankind Pharma Ltd", sector: "Pharma & Healthcare", dhanSymbol: "MANKIND", tradingViewSymbol: "NSE:MANKIND", isFnO: true, lotSize: 300 },
  { symbol: "ALKEM", name: "Alkem Laboratories", sector: "Pharma & Healthcare", dhanSymbol: "ALKEM", tradingViewSymbol: "NSE:ALKEM", isFnO: true, lotSize: 150 },
  { symbol: "SYNGENE", name: "Syngene International", sector: "Pharma & Healthcare", dhanSymbol: "SYNGENE", tradingViewSymbol: "NSE:SYNGENE", isFnO: true, lotSize: 900 },
  { symbol: "IPCALAB", name: "IPCA Laboratories", sector: "Pharma & Healthcare", dhanSymbol: "IPCALAB", tradingViewSymbol: "NSE:IPCALAB", isFnO: true, lotSize: 600 },
];

/**
 * Infrastructure, Capital Goods & Defence - 19 stocks
 */
export const INFRA_CAPITAL_GOODS_DEFENCE: ApprovedStock[] = [
  { symbol: "LT", name: "Larsen & Toubro", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "LT", tradingViewSymbol: "NSE:LT", isFnO: true, lotSize: 200 },
  { symbol: "ABB", name: "ABB India Ltd", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "ABB", tradingViewSymbol: "NSE:ABB", isFnO: true, lotSize: 100 },
  { symbol: "SIEMENS", name: "Siemens Ltd", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "SIEMENS", tradingViewSymbol: "NSE:SIEMENS", isFnO: true, lotSize: 150 },
  { symbol: "BEL", name: "Bharat Electronics", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "BEL", tradingViewSymbol: "NSE:BEL", isFnO: true, lotSize: 2500 },
  { symbol: "HAL", name: "Hindustan Aeronautics", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "HAL", tradingViewSymbol: "NSE:HAL", isFnO: true, lotSize: 150 },
  { symbol: "BHEL", name: "Bharat Heavy Electricals", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "BHEL", tradingViewSymbol: "NSE:BHEL", isFnO: true, lotSize: 2800 },
  { symbol: "CGPOWER", name: "CG Power and Industrial", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "CGPOWER", tradingViewSymbol: "NSE:CGPOWER", isFnO: true, lotSize: 1500 },
  { symbol: "CUMMINSIND", name: "Cummins India Ltd", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "CUMMINSIND", tradingViewSymbol: "NSE:CUMMINSIND", isFnO: true, lotSize: 225 },
  { symbol: "HAVELLS", name: "Havells India Ltd", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "HAVELLS", tradingViewSymbol: "NSE:HAVELLS", isFnO: true, lotSize: 400 },
  { symbol: "VOLTAS", name: "Voltas Ltd", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "VOLTAS", tradingViewSymbol: "NSE:VOLTAS", isFnO: true, lotSize: 550 },
  { symbol: "POLYCAB", name: "Polycab India Ltd", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "POLYCAB", tradingViewSymbol: "NSE:POLYCAB", isFnO: true, lotSize: 100 },
  { symbol: "KEI", name: "KEI Industries Ltd", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "KEI", tradingViewSymbol: "NSE:KEI", isFnO: true, lotSize: 250 },
  { symbol: "DIXON", name: "Dixon Technologies", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "DIXON", tradingViewSymbol: "NSE:DIXON", isFnO: true, lotSize: 75 },
  { symbol: "KAYNES", name: "Kaynes Technology", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "KAYNES", tradingViewSymbol: "NSE:KAYNES", isFnO: true, lotSize: 200 },
  { symbol: "AMBER", name: "Amber Enterprises", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "AMBER", tradingViewSymbol: "NSE:AMBER", isFnO: true, lotSize: 150 },
  { symbol: "BDL", name: "Bharat Dynamics Ltd", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "BDL", tradingViewSymbol: "NSE:BDL", isFnO: true, lotSize: 500 },
  { symbol: "MAZDOCK", name: "Mazagon Dock Shipbuilders", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "MAZDOCK", tradingViewSymbol: "NSE:MAZDOCK", isFnO: true, lotSize: 250 },
  { symbol: "COCHINSHIP", name: "Cochin Shipyard Ltd", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "COCHINSHIP", tradingViewSymbol: "NSE:COCHINSHIP", isFnO: true, lotSize: 400 },
  { symbol: "GRSE", name: "Garden Reach Shipbuilders", sector: "Infrastructure, Capital Goods & Defence", dhanSymbol: "GRSE", tradingViewSymbol: "NSE:GRSE", isFnO: true, lotSize: 500 },
];

/**
 * Chemicals & Materials - 14 stocks
 */
export const CHEMICALS_MATERIALS: ApprovedStock[] = [
  { symbol: "ASIANPAINT", name: "Asian Paints Ltd", sector: "Chemicals & Materials", dhanSymbol: "ASIANPAINT", tradingViewSymbol: "NSE:ASIANPAINT", isFnO: true, lotSize: 200 },
  { symbol: "PIDILITIND", name: "Pidilite Industries", sector: "Chemicals & Materials", dhanSymbol: "PIDILITIND", tradingViewSymbol: "NSE:PIDILITIND", isFnO: true, lotSize: 200 },
  { symbol: "BERGERPAINT", name: "Berger Paints India", sector: "Chemicals & Materials", dhanSymbol: "BERGEPAINT", tradingViewSymbol: "NSE:BERGERPAINT", isFnO: true, lotSize: 1250 },
  { symbol: "KANSAINER", name: "Kansai Nerolac Paints", sector: "Chemicals & Materials", dhanSymbol: "KANSAINER", tradingViewSymbol: "NSE:KANSAINER", isFnO: true, lotSize: 2000 },
  { symbol: "UPL", name: "UPL Ltd", sector: "Chemicals & Materials", dhanSymbol: "UPL", tradingViewSymbol: "NSE:UPL", isFnO: true, lotSize: 1200 },
  { symbol: "PIIND", name: "PI Industries Ltd", sector: "Chemicals & Materials", dhanSymbol: "PIIND", tradingViewSymbol: "NSE:PIIND", isFnO: true, lotSize: 200 },
  { symbol: "SRF", name: "SRF Ltd", sector: "Chemicals & Materials", dhanSymbol: "SRF", tradingViewSymbol: "NSE:SRF", isFnO: true, lotSize: 250 },
  { symbol: "DEEPAKNTR", name: "Deepak Nitrite Ltd", sector: "Chemicals & Materials", dhanSymbol: "DEEPAKNTR", tradingViewSymbol: "NSE:DEEPAKNTR", isFnO: true, lotSize: 275 },
  { symbol: "AARTIIND", name: "Aarti Industries Ltd", sector: "Chemicals & Materials", dhanSymbol: "AARTIIND", tradingViewSymbol: "NSE:AARTIIND", isFnO: true, lotSize: 1250 },
  { symbol: "NAVINFLUOR", name: "Navin Fluorine Intl", sector: "Chemicals & Materials", dhanSymbol: "NAVINFLUOR", tradingViewSymbol: "NSE:NAVINFLUOR", isFnO: true, lotSize: 175 },
  { symbol: "TATACHEM", name: "Tata Chemicals Ltd", sector: "Chemicals & Materials", dhanSymbol: "TATACHEM", tradingViewSymbol: "NSE:TATACHEM", isFnO: true, lotSize: 650 },
  { symbol: "COROMANDEL", name: "Coromandel International", sector: "Chemicals & Materials", dhanSymbol: "COROMANDEL", tradingViewSymbol: "NSE:COROMANDEL", isFnO: true, lotSize: 625 },
  { symbol: "CHAMBLFERT", name: "Chambal Fertilizers", sector: "Chemicals & Materials", dhanSymbol: "CHAMBLFERT", tradingViewSymbol: "NSE:CHAMBLFERT", isFnO: true, lotSize: 1750 },
  { symbol: "CLEAN", name: "Clean Science and Tech", sector: "Chemicals & Materials", dhanSymbol: "CLEAN", tradingViewSymbol: "NSE:CLEAN", isFnO: true, lotSize: 600 },
];

/**
 * Logistics, Transport & Other Active Stocks - 25 stocks
 */
export const LOGISTICS_TRANSPORT_OTHER: ApprovedStock[] = [
  { symbol: "INDIGO", name: "InterGlobe Aviation", sector: "Logistics, Transport & Other", dhanSymbol: "INDIGO", tradingViewSymbol: "NSE:INDIGO", isFnO: true, lotSize: 175 },
  { symbol: "CONCOR", name: "Container Corporation", sector: "Logistics, Transport & Other", dhanSymbol: "CONCOR", tradingViewSymbol: "NSE:CONCOR", isFnO: true, lotSize: 950 },
  { symbol: "IRCTC", name: "Indian Railway Catering", sector: "Logistics, Transport & Other", dhanSymbol: "IRCTC", tradingViewSymbol: "NSE:IRCTC", isFnO: true, lotSize: 1250 },
  { symbol: "RVNL", name: "Rail Vikas Nigam Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "RVNL", tradingViewSymbol: "NSE:RVNL", isFnO: true, lotSize: 3500 },
  { symbol: "IRFC", name: "Indian Railway Finance", sector: "Logistics, Transport & Other", dhanSymbol: "IRFC", tradingViewSymbol: "NSE:IRFC", isFnO: true, lotSize: 7500 },
  { symbol: "RAILTEL", name: "RailTel Corporation", sector: "Logistics, Transport & Other", dhanSymbol: "RAILTEL", tradingViewSymbol: "NSE:RAILTEL", isFnO: true, lotSize: 3000 },
  { symbol: "BEML", name: "BEML Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "BEML", tradingViewSymbol: "NSE:BEML", isFnO: true, lotSize: 175 },
  { symbol: "ADANIPORTS", name: "Adani Ports and SEZ", sector: "Logistics, Transport & Other", dhanSymbol: "ADANIPORTS", tradingViewSymbol: "NSE:ADANIPORTS", isFnO: true, lotSize: 650 },
  { symbol: "DELHIVERY", name: "Delhivery Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "DELHIVERY", tradingViewSymbol: "NSE:DELHIVERY", isFnO: true, lotSize: 2075 },
  { symbol: "INDHOTEL", name: "Indian Hotels Company", sector: "Logistics, Transport & Other", dhanSymbol: "INDHOTEL", tradingViewSymbol: "NSE:INDHOTEL", isFnO: true, lotSize: 1250 },
  { symbol: "PVRINOX", name: "PVR INOX Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "PVRINOX", tradingViewSymbol: "NSE:PVRINOX", isFnO: true, lotSize: 400 },
  { symbol: "MCX", name: "Multi Commodity Exchange", sector: "Logistics, Transport & Other", dhanSymbol: "MCX", tradingViewSymbol: "NSE:MCX", isFnO: true, lotSize: 250 },
  { symbol: "BSE", name: "BSE Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "BSE", tradingViewSymbol: "NSE:BSE", isFnO: true, lotSize: 1750 },
  { symbol: "CDSL", name: "Central Depository Services", sector: "Logistics, Transport & Other", dhanSymbol: "CDSL", tradingViewSymbol: "NSE:CDSL", isFnO: true, lotSize: 400 },
  { symbol: "ANGELONE", name: "Angel One Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "ANGELONE", tradingViewSymbol: "NSE:ANGELONE", isFnO: true, lotSize: 175 },
  { symbol: "IEX", name: "Indian Energy Exchange", sector: "Logistics, Transport & Other", dhanSymbol: "IEX", tradingViewSymbol: "NSE:IEX", isFnO: true, lotSize: 3500 },
  { symbol: "CAMS", name: "Computer Age Management", sector: "Logistics, Transport & Other", dhanSymbol: "CAMS", tradingViewSymbol: "NSE:CAMS", isFnO: true, lotSize: 200 },
  { symbol: "KFINTECH", name: "KFin Technologies Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "KFINTECH", tradingViewSymbol: "NSE:KFINTECH", isFnO: true, lotSize: 800 },
  { symbol: "POLICYBZR", name: "PB Fintech Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "POLICYBZR", tradingViewSymbol: "NSE:POLICYBZR", isFnO: true, lotSize: 500 },
  { symbol: "PAYTM", name: "One 97 Communications", sector: "Logistics, Transport & Other", dhanSymbol: "PAYTM", tradingViewSymbol: "NSE:PAYTM", isFnO: true, lotSize: 1250 },
  { symbol: "HUDCO", name: "Housing & Urban Dev Corp", sector: "Logistics, Transport & Other", dhanSymbol: "HUDCO", tradingViewSymbol: "NSE:HUDCO", isFnO: true, lotSize: 4000 },
  { symbol: "IREDA", name: "Indian Renewable Energy", sector: "Logistics, Transport & Other", dhanSymbol: "IREDA", tradingViewSymbol: "NSE:IREDA", isFnO: true, lotSize: 3000 },
  { symbol: "PFC", name: "Power Finance Corporation", sector: "Logistics, Transport & Other", dhanSymbol: "PFC", tradingViewSymbol: "NSE:PFC", isFnO: true, lotSize: 1750 },
  { symbol: "RECLTD", name: "REC Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "RECLTD", tradingViewSymbol: "NSE:RECLTD", isFnO: true, lotSize: 2100 },
  { symbol: "NBCC", name: "NBCC (India) Ltd", sector: "Logistics, Transport & Other", dhanSymbol: "NBCC", tradingViewSymbol: "NSE:NBCC", isFnO: true, lotSize: 12500 },
];

/**
 * Cement & Additional Financial - 10 stocks
 */
export const CEMENT_ADDITIONAL_FINANCIAL: ApprovedStock[] = [
  { symbol: "ULTRACEMCO", name: "UltraTech Cement Ltd", sector: "Cement & Additional Financial", dhanSymbol: "ULTRACEMCO", tradingViewSymbol: "NSE:ULTRACEMCO", isFnO: true, lotSize: 50 },
  { symbol: "GRASIM", name: "Grasim Industries Ltd", sector: "Cement & Additional Financial", dhanSymbol: "GRASIM", tradingViewSymbol: "NSE:GRASIM", isFnO: true, lotSize: 350 },
  { symbol: "SHREECEM", name: "Shree Cement Ltd", sector: "Cement & Additional Financial", dhanSymbol: "SHREECEM", tradingViewSymbol: "NSE:SHREECEM", isFnO: true, lotSize: 25 },
  { symbol: "AMBUJACEM", name: "Ambuja Cements Ltd", sector: "Cement & Additional Financial", dhanSymbol: "AMBUJACEM", tradingViewSymbol: "NSE:AMBUJACEM", isFnO: true, lotSize: 1250 },
  { symbol: "ACC", name: "ACC Ltd", sector: "Cement & Additional Financial", dhanSymbol: "ACC", tradingViewSymbol: "NSE:ACC", isFnO: true, lotSize: 300 },
  { symbol: "DALBHARAT", name: "Dalmia Bharat Ltd", sector: "Cement & Additional Financial", dhanSymbol: "DALBHARAT", tradingViewSymbol: "NSE:DALBHARAT", isFnO: true, lotSize: 400 },
  { symbol: "JKCEMENT", name: "JK Cement Ltd", sector: "Cement & Additional Financial", dhanSymbol: "JKCEMENT", tradingViewSymbol: "NSE:JKCEMENT", isFnO: true, lotSize: 200 },
  { symbol: "M&MFIN", name: "Mahindra & Mahindra Fin", sector: "Cement & Additional Financial", dhanSymbol: "M&MFIN", tradingViewSymbol: "NSE:M&MFIN", isFnO: true, lotSize: 2700 },
  { symbol: "CANFINHOME", name: "Can Fin Homes Ltd", sector: "Cement & Additional Financial", dhanSymbol: "CANFINHOME", tradingViewSymbol: "NSE:CANFINHOME", isFnO: true, lotSize: 1250 },
  { symbol: "PNBHOUSING", name: "PNB Housing Finance", sector: "Cement & Additional Financial", dhanSymbol: "PNBHOUSING", tradingViewSymbol: "NSE:PNBHOUSING", isFnO: true, lotSize: 1000 },
];

// ── CONSOLIDATED APPROVED 200 STOCKS ──

export const APPROVED_200_STOCKS: ApprovedStock[] = [
  ...BANKING_FINANCIAL,
  ...IT_TECHNOLOGY,
  ...AUTO_AUTO_COMPONENTS,
  ...FMCG_CONSUMER_RETAIL,
  ...METALS_MINING,
  ...ENERGY_OIL_POWER,
  ...PHARMA_HEALTHCARE,
  ...INFRA_CAPITAL_GOODS_DEFENCE,
  ...CHEMICALS_MATERIALS,
  ...LOGISTICS_TRANSPORT_OTHER,
  ...CEMENT_ADDITIONAL_FINANCIAL,
];

// Verify we have exactly 200 stocks
if (APPROVED_200_STOCKS.length !== 200) {
  console.error(`[APPROVED_INSTRUMENTS] Expected 200 stocks, got ${APPROVED_200_STOCKS.length}`);
}

// ── UTILITY FUNCTIONS ──

/**
 * Get approved stock by NSE symbol
 */
export function getApprovedStock(nseSymbol: string): ApprovedStock | undefined {
  return APPROVED_200_STOCKS.find(stock => stock.symbol === nseSymbol);
}

/**
 * Check if a symbol is in the approved list
 */
export function isApprovedStock(nseSymbol: string): boolean {
  return APPROVED_200_STOCKS.some(stock => stock.symbol === nseSymbol);
}

/**
 * Get all approved NSE symbols
 */
export function getApprovedSymbols(): string[] {
  return APPROVED_200_STOCKS.map(stock => stock.symbol);
}

/**
 * Get all approved stocks by sector
 */
export function getApprovedStocksBySector(sector: string): ApprovedStock[] {
  return APPROVED_200_STOCKS.filter(stock => stock.sector === sector);
}

/**
 * Get all F&O enabled stocks
 */
export function getApprovedFnOStocks(): ApprovedStock[] {
  return APPROVED_200_STOCKS.filter(stock => stock.isFnO);
}

/**
 * Export for backward compatibility with existing mockData.ts
 */
export const fnoStocks = getApprovedSymbols();

console.log(`[APPROVED_INSTRUMENTS] Loaded ${APPROVED_200_STOCKS.length} approved NSE stocks`);
