import { gunzipSync } from "node:zlib";
import { encodeInstrumentCatalogResponse } from "../../proxy-json-response.mjs";

describe("encodeInstrumentCatalogResponse", () => {
  it("gzip-compresses catalogs when the client accepts gzip", async () => {
    const data = {
      instruments: Array.from({ length: 100 }, (_, index) => ({
        securityId: String(index),
        exchangeSegment: "NSE_FNO",
        instrumentType: "OPTSTK",
      })),
    };

    const encoded = await encodeInstrumentCatalogResponse(data, "br, gzip");

    expect(encoded.contentEncoding).toBe("gzip");
    if (!Buffer.isBuffer(encoded.body)) throw new Error("Expected a gzip buffer.");
    expect(JSON.parse(gunzipSync(encoded.body).toString("utf8"))).toEqual(data);
    expect(encoded.body.length).toBeLessThan(Buffer.byteLength(JSON.stringify(data)));
  });

  it("keeps the response uncompressed when gzip is not acceptable", async () => {
    const data = { instruments: [] };

    const encoded = await encodeInstrumentCatalogResponse(data, "gzip;q=0, br");

    expect(encoded).toEqual({
      body: JSON.stringify(data),
      contentEncoding: null,
    });
  });
});
