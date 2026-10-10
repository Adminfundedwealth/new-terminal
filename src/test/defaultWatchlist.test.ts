import { describe, expect, it } from "vitest";
import { DEFAULT_WATCHLIST_SYMBOLS } from "@/lib/defaultWatchlist";

describe("default watchlist symbols", () => {
  it("contains the complete unique requested equity-symbol set", () => {
    expect(DEFAULT_WATCHLIST_SYMBOLS).toHaveLength(884);
    expect(new Set(DEFAULT_WATCHLIST_SYMBOLS).size).toBe(DEFAULT_WATCHLIST_SYMBOLS.length);
    expect(DEFAULT_WATCHLIST_SYMBOLS).toEqual(expect.arrayContaining([
      "3MINDIA",
      "AARTIDRUGS",
      "APLLTD",
      "ARE&M",
      "GVT&D",
      "ZYDUSWELL",
    ]));
  });
});
