import { classifyInstrument, isProductionInstrument } from "./instrumentClassification";
import { InstrumentMaster } from "./instrumentMaster";
// ── IndexedDB Manager ──
const DB_NAME = "mrchartist_market_db";
const DB_VERSION = 2;
let dbInstance = null;
function openDB() {
    if (dbInstance)
        return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Instruments store
            if (!db.objectStoreNames.contains("instruments")) {
                const instrumentStore = db.createObjectStore("instruments", { keyPath: "securityId" });
                instrumentStore.createIndex("symbol", "symbol", { unique: false });
                instrumentStore.createIndex("exchangeSegment", "exchangeSegment", { unique: false });
                instrumentStore.createIndex("instrumentType", "instrumentType", { unique: false });
            }
            // Price snapshots
            if (!db.objectStoreNames.contains("prices")) {
                const priceStore = db.createObjectStore("prices", { keyPath: "securityId" });
                priceStore.createIndex("symbol", "symbol", { unique: false });
            }
            // Candle history
            if (!db.objectStoreNames.contains("candles")) {
                const candleStore = db.createObjectStore("candles", { keyPath: ["securityId", "interval"] });
                candleStore.createIndex("symbol", "symbol", { unique: false });
            }
            // Metadata
            if (!db.objectStoreNames.contains("metadata")) {
                db.createObjectStore("metadata", { keyPath: "key" });
            }
        };
        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };
        request.onerror = () => {
            reject(new Error("Failed to open IndexedDB"));
        };
    });
}
// ── Generic CRUD operations ──
async function putItem(storeName, item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function putItems(storeName, items) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        for (const item of items) {
            store.put(item);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function getItem(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function getAllItems(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function getItemsByIndex(storeName, indexName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const index = tx.objectStore(storeName).index(indexName);
        const request = index.getAll(value);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function clearStore(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function countItems(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
// ── Public API ──
// Instruments
export async function saveInstruments(items) {
    const master = new InstrumentMaster();
    const issues = master.addAll(items);
    if (issues.length > 0)
        throw new Error(`Instrument master rejected ${issues.length} duplicate or conflicting row(s).`);
    const existing = await getAllInstruments();
    const existingById = new Map(existing.map((instrument) => [instrument.securityId, instrument]));
    const existingBySymbol = new Map(existing.map((instrument) => [`${instrument.exchange}|${instrument.tradingSymbol.toUpperCase()}`, instrument]));
    const toSave = [];
    for (const instrument of items) {
        const byId = existingById.get(instrument.securityId);
        if (byId) {
            if (JSON.stringify(byId) !== JSON.stringify(instrument))
                throw new Error(`Instrument ${instrument.securityId} conflicts with persisted metadata.`);
            continue;
        }
        const symbolKey = `${instrument.exchange}|${instrument.tradingSymbol.toUpperCase()}`;
        const bySymbol = existingBySymbol.get(symbolKey);
        if (bySymbol && bySymbol.securityId !== instrument.securityId)
            throw new Error(`Exchange-symbol ${symbolKey} conflicts with persisted instrument ${bySymbol.securityId}.`);
        toSave.push(instrument);
    }
    if (toSave.length > 0)
        await putItems("instruments", toSave);
}
export const getInstrument = (securityId) => getItem("instruments", securityId);
export const getAllInstruments = () => getAllItems("instruments");
export const getInstrumentsBySegment = (segment) => getItemsByIndex("instruments", "exchangeSegment", segment);
export const getInstrumentsByType = (type) => getItemsByIndex("instruments", "instrumentType", type);
export async function getInstrumentsByCategory(category) {
    const instruments = await getAllInstruments();
    return instruments.filter((instrument) => isProductionInstrument(instrument) && classifyInstrument(instrument) === category);
}
export const clearInstruments = () => clearStore("instruments");
export const countInstruments = () => countItems("instruments");
const INDEX_LOOKUP_ALIASES = {
    NIFTY: ["NIFTY", "NIFTY 50"],
    BANKNIFTY: ["BANKNIFTY", "NIFTY BANK"],
    FINNIFTY: ["FINNIFTY", "NIFTY FINANCIAL SERVICES", "NIFTY FIN SERVICE", "FIN NIFTY"],
    MIDCPNIFTY: ["MIDCPNIFTY", "NIFTY MIDCAP 50", "MIDCAP NIFTY"],
    INDIAVIX: ["INDIAVIX", "INDIA VIX"],
};
function normalizeLookupSymbol(value) {
    return (value || "")
        .toUpperCase()
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
export function matchesInstrumentLookupSymbol(query, instrument) {
    const normalizedQuery = normalizeLookupSymbol(query);
    if (!normalizedQuery)
        return false;
    const aliases = new Set();
    for (const candidate of [instrument.symbol, instrument.tradingSymbol, normalizedQuery]) {
        const normalized = normalizeLookupSymbol(candidate);
        if (!normalized)
            continue;
        aliases.add(normalized);
        aliases.add(normalized.replace(/\s+/g, ""));
        for (const [canonical, variants] of Object.entries(INDEX_LOOKUP_ALIASES)) {
            const aliasSet = [canonical, ...variants].map(normalizeLookupSymbol);
            if (aliasSet.includes(normalized) || aliasSet.includes(normalizedQuery)) {
                aliasSet.forEach((alias) => {
                    aliases.add(alias);
                    aliases.add(alias.replace(/\s+/g, ""));
                });
            }
        }
    }
    return [...aliases].some((alias) => alias === normalizedQuery || alias === normalizedQuery.replace(/\s+/g, ""));
}
// Instrument lookup by symbol
export async function findInstrumentBySymbol(symbol) {
    const results = await findInstrumentsBySymbol(symbol);
    return results[0];
}
export async function findInstrumentsBySymbol(symbol) {
    const normalizedQuery = normalizeLookupSymbol(symbol);
    if (!normalizedQuery)
        return [];
    const allInstruments = await getAllInstruments();
    return allInstruments.filter((instrument) => matchesInstrumentLookupSymbol(normalizedQuery, instrument));
}
export async function findInstrumentByExchangeSymbol(exchange, tradingSymbol) {
    const normalizedExchange = exchange.trim().toUpperCase();
    const normalizedSymbol = tradingSymbol.trim().toUpperCase();
    if (!normalizedExchange || !normalizedSymbol)
        return undefined;
    const instruments = await getAllInstruments();
    return instruments.find((instrument) => instrument.exchange.toUpperCase() === normalizedExchange && instrument.tradingSymbol.toUpperCase() === normalizedSymbol);
}
// Get all F&O stocks (unique equity symbols in NSE_FNO segment)
export async function getFnOStockList() {
    const fnoInstruments = await getInstrumentsBySegment("NSE_FNO");
    // Get unique underlying symbols (FUTSTK type gives us the stock names)
    const seen = new Set();
    return fnoInstruments
        .filter((i) => isProductionInstrument(i) && i.instrumentType === "FUTSTK" && !seen.has(i.symbol))
        .map((i) => {
        seen.add(i.symbol);
        return i;
    })
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
}
// Prices
export const savePriceSnapshot = (item) => putItem("prices", item);
export const savePriceSnapshots = (items) => putItems("prices", items);
export const getPriceSnapshot = (securityId) => getItem("prices", securityId);
export const getAllPriceSnapshots = () => getAllItems("prices");
export const clearPrices = () => clearStore("prices");
export const countPrices = () => countItems("prices");
// Get price by symbol
export async function getPriceBySymbol(symbol) {
    const results = await getItemsByIndex("prices", "symbol", symbol);
    return results[0];
}
// Candle history
export const saveCandleHistory = (item) => putItem("candles", item);
export const getCandleHistory = (securityId, interval) => getItem("candles", [securityId, interval]);
export const getAllCandleHistories = () => getAllItems("candles");
export const clearCandles = () => clearStore("candles");
export const countCandles = () => countItems("candles");
// Metadata
export const setMetadata = (key, value) => putItem("metadata", { key, value, updatedAt: Date.now() });
export const getMetadata = (key) => getItem("metadata", key);
export async function getDatabaseStats() {
    const [instruments, prices, candles, instrMeta, priceMeta, candleMeta] = await Promise.all([
        countInstruments(),
        countPrices(),
        countCandles(),
        getMetadata("lastInstrumentUpdate"),
        getMetadata("lastPriceUpdate"),
        getMetadata("lastCandleUpdate"),
    ]);
    return {
        instruments,
        prices,
        candles,
        lastInstrumentUpdate: instrMeta?.value || null,
        lastPriceUpdate: priceMeta?.value || null,
        lastCandleUpdate: candleMeta?.value || null,
    };
}
// ── Clear entire database ──
export async function clearAllData() {
    await Promise.all([clearInstruments(), clearPrices(), clearCandles()]);
}
