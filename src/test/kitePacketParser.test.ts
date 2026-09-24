import { describe, expect, it } from "vitest";
import { parseKiteBinaryPackets } from "../../kite-packet-parser.mjs";

describe("Kite binary packet parser", () => {
  it("normalizes a NIFTY quote packet to the terminal identity", () => {
    const buffer = new ArrayBuffer(48);
    const view = new DataView(buffer);
    view.setUint16(0, 1, false);
    view.setUint16(2, 44, false);
    view.setUint32(4, 256265, false);
    view.setUint32(8, 2334640, false);
    view.setUint32(12, 100, false);
    view.setUint32(16, 2330000, false);
    view.setUint32(20, 1000, false);
    view.setUint32(24, 120000, false);
    view.setUint32(28, 90000, false);
    view.setUint32(32, 2327060, false);
    view.setUint32(36, 2340000, false);
    view.setUint32(40, 2320000, false);
    view.setUint32(44, 2327060, false);

    const [tick] = parseKiteBinaryPackets(buffer);

    expect(tick).toMatchObject({
      provider: "zerodha",
      instrumentToken: 256265,
      securityId: 13,
      symbol: "NIFTY",
      exchangeSegment: "IDX_I",
      ltp: 23346.4,
      close: 23270.6,
    });
    expect(tick.change).toBeCloseTo(75.8, 8);
  });
});
