const KITE_TOKEN_MAP = new Map([
  [256265, { securityId: 13, symbol: "NIFTY", exchangeSegment: "IDX_I" }],
  [260105, { securityId: 25, symbol: "BANKNIFTY", exchangeSegment: "IDX_I" }],
  [738561, { securityId: 738561, symbol: "RELIANCE", exchangeSegment: "NSE_EQ" }],
  [295321, { securityId: 295321, symbol: "TCS", exchangeSegment: "NSE_EQ" }],
  [408065, { securityId: 408065, symbol: "INFY", exchangeSegment: "NSE_EQ" }],
  [257801, { securityId: 27, symbol: "FINNIFTY", exchangeSegment: "IDX_I" }],
  [288009, { securityId: 442, symbol: "MIDCPNIFTY", exchangeSegment: "IDX_I" }],
  [264969, { securityId: 26, symbol: "INDIAVIX", exchangeSegment: "IDX_I" }],
]);

export function registerKiteToken(instrumentToken, mapping) {
  KITE_TOKEN_MAP.set(Number(instrumentToken), mapping);
}

export function registerKiteTokens(tokens) {
  if (!Array.isArray(tokens)) return;
  for (const token of tokens) {
    if (token && token.instrumentToken != null) {
      registerKiteToken(token.instrumentToken, {
        securityId: token.securityId ?? Number(token.instrumentToken),
        symbol: token.symbol || `KITE_${token.instrumentToken}`,
        exchangeSegment: token.exchangeSegment || "NSE",
      });
    }
  }
}

function readUInt32BE(view, offset) {
  return view.getUint32(offset, false);
}

function readPrice(view, offset) {
  return readUInt32BE(view, offset) / 100;
}

export function parseKiteBinaryPackets(input) {
  const buffer = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buffer.byteLength < 2) return [];

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const packetCount = view.getUint16(0, false);
  const packets = [];
  let offset = 2;

  for (let index = 0; index < packetCount && offset + 2 <= buffer.byteLength; index += 1) {
    const packetLength = view.getUint16(offset, false);
    offset += 2;
    if (packetLength < 8 || offset + packetLength > buffer.byteLength) break;

    const packet = new DataView(buffer.buffer, buffer.byteOffset + offset, packetLength);
    const instrumentToken = readUInt32BE(packet, 0);
    const mapping = KITE_TOKEN_MAP.get(instrumentToken) || {
      securityId: instrumentToken,
      symbol: `KITE_${instrumentToken}`,
      exchangeSegment: "NSE",
    };
    const tick = {
      type: "quote",
      provider: "zerodha",
      instrumentToken,
      securityId: mapping.securityId,
      symbol: mapping.symbol,
      exchangeSegment: mapping.exchangeSegment,
      ltp: readPrice(packet, 4),
      timestamp: Date.now(),
    };

    if (packetLength >= 44) {
      tick.lastTradedQuantity = readUInt32BE(packet, 8);
      tick.averagePrice = readPrice(packet, 12);
      tick.volume = readUInt32BE(packet, 16);
      tick.totalBuyQty = readUInt32BE(packet, 20);
      tick.totalSellQty = readUInt32BE(packet, 24);
      tick.open = readPrice(packet, 28);
      tick.high = readPrice(packet, 32);
      tick.low = readPrice(packet, 36);
      tick.close = readPrice(packet, 40);
      tick.prevClose = tick.close;
      tick.change = tick.ltp - tick.close;
      tick.changePercent = tick.close ? (tick.change / tick.close) * 100 : 0;
    }

    if (packetLength >= 64) {
      tick.lastTradedTime = readUInt32BE(packet, 44);
      tick.oi = readUInt32BE(packet, 48);
      tick.oiDayHigh = readUInt32BE(packet, 52);
      tick.oiDayLow = readUInt32BE(packet, 56);
      tick.exchangeTimestamp = readUInt32BE(packet, 60);
    }

    packets.push(tick);
    offset += packetLength;
  }

  return packets;
}
